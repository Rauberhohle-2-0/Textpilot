/**
 * The library store: the user's `Textpilot` folder, read and written as
 * the tree it is.
 *
 * A document is a `.md` file, a folder is a directory, and the filename
 * is the title - there is no sidecar index to drift from what is on
 * disk. That makes the two halves one store, because they are one
 * filesystem: deleting a folder is a recursive remove rather than a
 * careful cascade, and a file dropped in from any other editor shows up
 * on the next list.
 *
 * The interface is still the seam: `documents` and `folders` are handed
 * to their routes separately, so the UI does not know they share a
 * backing store, and swapping the implementation would not touch them.
 *
 * Every id-to-path step goes through `shared/paths.ts`, so a request can
 * never read or write outside the library.
 */
import {
  type Dirent,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import {
  deriveTitle,
  MAX_DOCUMENT_BYTES,
  utf8ByteLength,
  type DocumentMeta,
  type DocumentRecord,
} from "../../../shared/documents.ts";
import type { FolderMeta } from "../../../shared/folders.ts";
import {
  decodeId,
  encodeId,
  relativeToRoot,
  resolveWithinLibrary,
  sanitizeName,
  uniqueName,
} from "../../../shared/paths.ts";
import type { Logger } from "../../../logging/logger.ts";

/** Documents are Markdown; everything else in the tree is ignored. */
const MARKDOWN_EXTENSION = ".md";

/** Names starting with this are the app's own business and never listed. */
const HIDDEN_PREFIX = ".";

export interface DocumentStore {
  list(): Promise<DocumentMeta[]>;
  create(text?: string, parentId?: string | null): Promise<DocumentRecord>;
  load(id: string): Promise<DocumentRecord>;
  save(id: string, text: string): Promise<DocumentRecord>;
  /** Remove the document's file; false when there was nothing to remove. */
  delete(id: string): Promise<boolean>;
  /** Move a document into a folder (null = the library root). */
  move(id: string, parentId: string | null): Promise<DocumentRecord>;
  /** Rename the document's file; the filename is the title. */
  rename(id: string, title: string): Promise<DocumentRecord>;
}

export interface FolderStore {
  list(): Promise<FolderMeta[]>;
  create(name: string, parentId?: string | null): Promise<FolderMeta>;
  rename(id: string, name: string): Promise<FolderMeta>;
  /** Move a folder (and thereby its subtree) under a new parent. */
  move(id: string, parentId: string | null): Promise<FolderMeta>;
  delete(id: string): Promise<boolean>;
}

/** The two route-facing halves, backed by one directory tree. */
export interface LibraryStore {
  readonly documents: DocumentStore;
  readonly folders: FolderStore;
}

/**
 * Raised when a document the caller named does not exist.
 *
 * The routes turn exactly this into a 404. Anything else that goes wrong
 * is a server problem and must not masquerade as one.
 */
export class DocumentNotFoundError extends Error {
  constructor(id: string) {
    super(`document not found: ${id}`);
    this.name = "DocumentNotFoundError";
  }
}

/** Raised when a document exists but is too large to read. */
export class DocumentTooLargeError extends Error {
  constructor(id: string) {
    super(`document too large: ${id}`);
    this.name = "DocumentTooLargeError";
  }
}

/** Raised when a folder the caller named does not exist. */
export class FolderNotFoundError extends Error {
  constructor(id: string) {
    super(`folder not found: ${id}`);
    this.name = "FolderNotFoundError";
  }
}

/**
 * Raised when the placement asked for is impossible: a parent that does
 * not exist, or a move that would put a folder inside its own subtree.
 * The caller's request is the problem, so the routes answer 400.
 */
export class FolderPlacementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FolderPlacementError";
  }
}

export interface FilesystemLibraryOptions {
  /** The library root; created lazily, on the first write. */
  root: string;
  logger?: Logger;
}

export function createFilesystemLibrary({
  root,
  logger,
}: FilesystemLibraryOptions): LibraryStore {
  const log = logger?.child("library");

  /** Create the root only when something is about to be written. */
  function ensureRoot(): void {
    mkdirSync(root, { recursive: true });
  }

  // ---------------------------------------------------------------
  // Paths
  // ---------------------------------------------------------------

  /** Resolve a root-relative path, or null when it escapes the library. */
  function safeResolve(relativePath: string): string | null {
    try {
      return resolveWithinLibrary(root, relativePath);
    } catch {
      return null;
    }
  }

  function isDirectory(path: string): boolean {
    try {
      return lstatSync(path).isDirectory();
    } catch {
      return false;
    }
  }

  function isFile(path: string): boolean {
    try {
      return lstatSync(path).isFile();
    } catch {
      return false;
    }
  }

  /** The file a document id names, or a not-found error. */
  function documentLocation(id: string): { relative: string; absolute: string } {
    const relative = decodeId(id);
    if (relative === null || !relative.toLowerCase().endsWith(MARKDOWN_EXTENSION)) {
      throw new DocumentNotFoundError(id);
    }
    const absolute = safeResolve(relative);
    if (absolute === null) throw new DocumentNotFoundError(id);
    return { relative, absolute };
  }

  /** The directory a folder id names, or null when it is not one. */
  function folderLocation(id: string): string | null {
    const relative = decodeId(id);
    if (relative === null) return null;
    const absolute = safeResolve(relative);
    return absolute !== null && isDirectory(absolute) ? absolute : null;
  }

  /**
   * The directory a `parentId` names - the root for null - or a
   * placement error, so a document is never written somewhere that is
   * not a folder.
   */
  function resolveDir(parentId: string | null): string {
    if (parentId === null) {
      ensureRoot();
      return root;
    }
    const directory = folderLocation(parentId);
    if (directory === null) throw new FolderPlacementError(`parent folder not found: ${parentId}`);
    return directory;
  }

  function parentDirOf(relativePath: string): string {
    const index = relativePath.lastIndexOf("/");
    return index === -1 ? "" : relativePath.slice(0, index);
  }

  function titleOf(relativePath: string): string {
    const name = basename(relativePath);
    return name.slice(0, -MARKDOWN_EXTENSION.length);
  }

  // ---------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------

  /**
   * One pass over the library, depth-first. Hidden entries and symlinks
   * are skipped: the first keeps the app's own marker (and any `.git`)
   * out of the sidebar, the second keeps the walk from leaving the tree
   * - and from looping on itself.
   */
  function walk(): { folders: FolderMeta[]; documents: DocumentMeta[] } {
    const folders: FolderMeta[] = [];
    const documents: DocumentMeta[] = [];

    function collect(relativeDir: string): void {
      const directory = relativeDir === "" ? root : safeResolve(relativeDir);
      if (directory === null) return;
      let entries: Dirent[];
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch {
        return; // Missing or unreadable: nothing under it.
      }

      const parentId = relativeDir === "" ? null : encodeId(relativeDir);
      for (const entry of entries) {
        if (entry.name.startsWith(HIDDEN_PREFIX) || entry.isSymbolicLink()) continue;
        const childRelative = relativeDir === "" ? entry.name : `${relativeDir}/${entry.name}`;

        if (entry.isDirectory()) {
          folders.push({ id: encodeId(childRelative), name: entry.name, parentId });
          collect(childRelative);
          continue;
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(MARKDOWN_EXTENSION)) continue;

        const absolute = join(directory, entry.name);
        try {
          const stats = statSync(absolute);
          // A file too large to open must not break the sidebar for
          // every other document, so it is simply not listed (a load
          // still reports it as too large).
          if (stats.size > MAX_DOCUMENT_BYTES) continue;
          documents.push({
            id: encodeId(childRelative),
            title: titleOf(childRelative),
            updatedAt: new Date(stats.mtimeMs).toISOString(),
            parentId,
          });
        } catch {
          // Unreadable: not a document we can offer.
        }
      }
    }

    collect("");
    return { folders, documents };
  }

  function recordFor(absolutePath: string, text: string): DocumentRecord {
    const relativePath = relativeToRoot(root, absolutePath);
    const stats = statSync(absolutePath);
    const parent = parentDirOf(relativePath);
    return {
      id: encodeId(relativePath),
      text,
      title: titleOf(relativePath),
      updatedAt: new Date(stats.mtimeMs).toISOString(),
      parentId: parent === "" ? null : encodeId(parent),
    };
  }

  function folderMeta(absolutePath: string): FolderMeta {
    const relativePath = relativeToRoot(root, absolutePath);
    const parent = parentDirOf(relativePath);
    return {
      id: encodeId(relativePath),
      name: basename(relativePath),
      parentId: parent === "" ? null : encodeId(parent),
    };
  }

  function readText(absolutePath: string): string {
    return readFileSync(absolutePath, "utf8");
  }

  // ---------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------

  /** Write through a sibling temp file and rename, as everywhere else.
   *
   * Hardened: the temp name carries the pid plus randomness so two
   * concurrent saves never share it, a pre-planted symlink at the temp
   * path is removed instead of followed, and the file is created with
   * `wx` so an existing file is never silently overwritten.
   */
  function writeAtomic(absolutePath: string, text: string): void {
    mkdirSync(dirname(absolutePath), { recursive: true });
    const temp =
      `${absolutePath}.${process.pid}.` +
      `${Math.random().toString(36).slice(2)}.tmp`;
    try {
      writeFileSync(temp, text, { flag: "wx" });
    } catch (error) {
      // A leftover temp from a crashed run would otherwise wedge every
      // future save with EEXIST; one retry after removing it is safe
      // because the name is unique to this process.
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "EEXIST"
      ) {
        try {
          unlinkSync(temp);
        } catch {
          // Already gone.
        }
        writeFileSync(temp, text, { flag: "wx" });
      } else {
        throw error;
      }
    }
    // The temp path is unpredictable (pid + randomness), but verify we
    // did not write through a planted symlink before renaming into place.
    try {
      if (lstatSync(temp).isSymbolicLink()) {
        unlinkSync(temp);
        throw new Error(`refusing to rename through symlink: ${temp}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("refusing")) throw error;
      // lstat failed: temp vanished mid-write; let rename surface it.
    }
    try {
      renameSync(temp, absolutePath);
    } catch (renameError) {
      try {
        unlinkSync(temp);
      } catch {
        // Best effort cleanup.
      }
      throw renameError;
    }
  }

  // ---------------------------------------------------------------
  // Documents
  // ---------------------------------------------------------------

  const documents: DocumentStore = {
    async list() {
      const found = walk().documents;
      // Most recently edited first - the order `resolveActiveDocument`
      // relies on to pick what to open at boot.
      return found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async create(text = "", parentId = null) {
      if (utf8ByteLength(text) > MAX_DOCUMENT_BYTES) throw new DocumentTooLargeError("new document");
      const directory = resolveDir(parentId);
      const base = sanitizeName(deriveTitle(text));
      const name = uniqueName(directory, base, MARKDOWN_EXTENSION);
      const absolute = join(directory, name);
      writeAtomic(absolute, text);
      const record = recordFor(absolute, text);
      log?.info("document created", { id: record.id });
      return record;
    },

    async load(id) {
      const { absolute } = documentLocation(id);
      if (!isFile(absolute)) throw new DocumentNotFoundError(id);
      if (statSync(absolute).size > MAX_DOCUMENT_BYTES) throw new DocumentTooLargeError(id);
      return recordFor(absolute, readText(absolute));
    },

    async save(id, text) {
      if (utf8ByteLength(text) > MAX_DOCUMENT_BYTES) throw new DocumentTooLargeError(id);
      const { absolute } = documentLocation(id);
      if (!isFile(absolute)) throw new DocumentNotFoundError(id);
      writeAtomic(absolute, text);
      log?.debug("document saved", { id, bytes: utf8ByteLength(text) });
      return recordFor(absolute, text);
    },

    async delete(id) {
      let absolute: string;
      try {
        absolute = documentLocation(id).absolute;
      } catch {
        return false;
      }
      if (!isFile(absolute)) return false;
      try {
        rmSync(absolute);
        log?.info("document deleted", { id });
        return true;
      } catch {
        return false;
      }
    },

    async move(id, parentId) {
      const { relative, absolute } = documentLocation(id);
      if (!isFile(absolute)) throw new DocumentNotFoundError(id);
      const directory = resolveDir(parentId);
      if (dirname(absolute) === directory) return recordFor(absolute, readText(absolute));

      const name = uniqueName(directory, titleOf(relative), MARKDOWN_EXTENSION);
      const destination = join(directory, name);
      renameSync(absolute, destination);
      const record = recordFor(destination, readText(destination));
      log?.info("document moved", { id, parentId, to: record.id });
      return record;
    },

    async rename(id, title) {
      const { relative, absolute } = documentLocation(id);
      if (!isFile(absolute)) throw new DocumentNotFoundError(id);
      const directory = dirname(absolute);
      // The source is excluded from the collision check: a no-op or a
      // case-only rename must not be pushed aside as "Name 2".
      const name = uniqueName(directory, sanitizeName(title), MARKDOWN_EXTENSION, basename(relative));
      const destination = join(directory, name);
      if (destination !== absolute) renameSync(absolute, destination);
      const record = recordFor(destination, readText(destination));
      log?.info("document renamed", { id, to: record.id });
      return record;
    },
  };

  // ---------------------------------------------------------------
  // Folders
  // ---------------------------------------------------------------

  const folders: FolderStore = {
    async list() {
      return walk().folders;
    },

    async create(name, parentId = null) {
      const directory = resolveDir(parentId);
      const folderName = uniqueName(directory, sanitizeName(name, "New Folder"));
      const absolute = join(directory, folderName);
      mkdirSync(absolute, { recursive: true });
      const folder = folderMeta(absolute);
      log?.info("folder created", { id: folder.id, name: folder.name });
      return folder;
    },

    async rename(id, name) {
      const source = folderLocation(id);
      if (source === null) throw new FolderNotFoundError(id);
      const directory = dirname(source);
      const folderName = uniqueName(
        directory,
        sanitizeName(name, "New Folder"),
        "",
        basename(source),
      );
      const destination = join(directory, folderName);
      if (destination !== source) renameSync(source, destination);
      const folder = folderMeta(destination);
      log?.info("folder renamed", { id, name: folder.name });
      return folder;
    },

    async move(id, parentId) {
      const source = folderLocation(id);
      if (source === null) throw new FolderNotFoundError(id);
      const directory = resolveDir(parentId);
      // A folder can never move inside itself or one of its descendants;
      // the path prefix is exactly that test.
      if (source === directory || directory.startsWith(source + sep)) {
        throw new FolderPlacementError("cannot move a folder into its own subtree");
      }
      if (dirname(source) === directory) return folderMeta(source);

      const destination = join(directory, uniqueName(directory, basename(source)));
      renameSync(source, destination);
      const folder = folderMeta(destination);
      log?.info("folder moved", { id, parentId, to: folder.id });
      return folder;
    },

    async delete(id) {
      const source = folderLocation(id);
      if (source === null) return false;
      // Defense in depth for the recursive remove below: the id codec
      // can never name the root (empty path) or a hidden entry, but a
      // recursive rm must never depend on a single upstream check.
      if (source === root) return false;
      if (basename(source).startsWith(".")) return false;
      const rel = relativeToRoot(root, source);
      if (rel === "" || rel.startsWith("..") || rel.startsWith(".")) return false;
      // Re-verify it is a real directory, not a symlink swapped in
      // between lookup and removal.
      try {
        if (!lstatSync(source).isDirectory() || lstatSync(source).isSymbolicLink()) return false;
      } catch {
        return false;
      }
      // Count the blast radius before it is gone, so the log says what
      // a UI confirmation should have described.
      let entries = 0;
      try {
        const tree = walk();
        const under = (relPath: string): boolean =>
          relPath === rel || relPath.startsWith(`${rel}/`);
        entries =
          tree.folders.filter((f) => {
            const p = decodeId(f.id);
            return p !== null && under(p);
          }).length +
          tree.documents.filter((d) => {
            const p = decodeId(d.id);
            return p !== null && under(p);
          }).length;
      } catch {
        entries = 0;
      }
      try {
        // The subtree is the directory: removing it removes every child
        // folder and document with it. The UI must confirm this; the
        // server refuses the cases above that must never be removed.
        rmSync(source, { recursive: true, force: true });
        log?.info("folder deleted", { id, entries });
        return true;
      } catch {
        return false;
      }
    },
  };

  return { documents, folders };
}
