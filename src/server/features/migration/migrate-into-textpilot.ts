/**
 * The one-time move into the library: old work becomes `.md` files and
 * real directories under `<Documents>/Textpilot`.
 *
 * Before this the app kept one JSON file per document in the project's
 * `data/` directory and all folders in a single `folders.json`. Nothing
 * writes those any more; on first launch this reads them and lays out
 * the equivalent tree, then leaves the old files exactly where they are.
 *
 * A hidden `.textpilot/migrated.json` marker makes it one-shot: the
 * library being empty is not enough on its own, because a user who
 * deletes every note should not have old ones resurrected on the next
 * launch. Runs only from real entry points - tests build the app or the
 * store directly and never point this at a real Documents folder.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deriveTitle } from "../../../shared/documents.ts";
import { sanitizeName, uniqueName } from "../../../shared/paths.ts";
import type { Logger } from "../../../logging/logger.ts";

/** Held inside the library but invisible to the app's own tree walks. */
const MARKER_DIRECTORY = ".textpilot";
const MARKER_FILE = "migrated.json";

export interface TextpilotMigrationOptions {
  /** The library root the legacy work is imported into. */
  root: string;
  /** The pre-documents single note. */
  legacyNote: string;
  /** The directory of per-document JSON files. */
  legacyDocuments: string;
  /** The JSON file that held every folder. */
  legacyFolders: string;
  logger?: Logger;
}

/** True when anything was imported - the library was seeded from old data. */
export async function migrateIntoTextpilot({
  root,
  legacyNote,
  legacyDocuments,
  legacyFolders,
  logger,
}: TextpilotMigrationOptions): Promise<boolean> {
  const log = logger?.child("migration");
  try {
    const marker = join(root, MARKER_DIRECTORY, MARKER_FILE);
    if (existsSync(marker)) return false;

    // Existing library content means there is nothing to seed; record
    // that so the abandoned legacy files are never imported later.
    if (hasLibraryContent(root)) {
      writeMarker(marker, 0);
      return false;
    }

    let imported = importLegacyWork({ root, legacyDocuments, legacyFolders, log });
    imported += importLegacyNote({ root, notePath: legacyNote, log });

    writeMarker(marker, imported);
    if (imported > 0) log?.info("legacy data imported into the library", { imported });
    return imported > 0;
  } catch (error) {
    log?.warn("library migration failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** Any `.md` file or visible directory under the root. */
function hasLibraryContent(root: string): boolean {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return false; // No library directory yet: nothing to keep.
  }
  return entries.some(
    (entry) =>
      !entry.name.startsWith(".") &&
      (entry.isDirectory() || entry.name.toLowerCase().endsWith(".md")),
  );
}

/** The old folders and documents, recreated as directories and files. */
function importLegacyWork({
  root,
  legacyDocuments,
  legacyFolders,
  log,
}: {
  root: string;
  legacyDocuments: string;
  legacyFolders: string;
  log?: Logger;
}): number {
  if (!existsSync(legacyDocuments)) return 0;

  // Legacy folder id -> the directory it became, built parent-first so
  // a child can always find its parent already placed.
  const folderPaths = new Map<string, string>();
  const pending = readLegacyFolders(legacyFolders);
  while (pending.length > 0) {
    const remaining: typeof pending = [];
    let progressed = false;
    for (const folder of pending) {
      const parentKey = folder.parentId ?? "";
      const parentPath = parentKey === "" ? root : folderPaths.get(parentKey);
      if (parentPath === undefined) {
        remaining.push(folder);
        continue;
      }
      const directory = join(parentPath, uniqueName(parentPath, sanitizeName(folder.name)));
      mkdirSync(directory, { recursive: true });
      folderPaths.set(folder.id, directory);
      progressed = true;
    }
    // A parent that never appears (corrupt data) must not spin forever.
    if (!progressed) {
      for (const folder of remaining) {
        const directory = join(root, uniqueName(root, sanitizeName(folder.name)));
        mkdirSync(directory, { recursive: true });
        folderPaths.set(folder.id, directory);
      }
      break;
    }
    pending.length = 0;
    pending.push(...remaining);
  }

  let imported = 0;
  for (const name of listJsonFiles(legacyDocuments)) {
    const stored = readLegacyDocument(join(legacyDocuments, name));
    if (stored === null) continue;
    const parentId = stored.parentId ?? "";
    const directory = parentId === "" ? root : (folderPaths.get(parentId) ?? root);
    writeMarkdown(directory, deriveTitle(stored.text), stored.text);
    imported += 1;
  }
  if (imported > 0) log?.info("legacy documents imported", { count: imported });
  return imported;
}

/** The single-note era's file, imported as a root-level `.md`. */
function importLegacyNote({
  root,
  notePath,
  log,
}: {
  root: string;
  notePath: string;
  log?: Logger;
}): number {
  try {
    const note = JSON.parse(readFileSync(notePath, "utf8")) as { text?: unknown };
    if (typeof note.text !== "string" || note.text.trim().length === 0) return 0;
    writeMarkdown(root, deriveTitle(note.text), note.text);
    log?.info("legacy note imported");
    return 1;
  } catch {
    return 0; // Missing, unreadable or corrupt: nothing to migrate.
  }
}

function writeMarkdown(directory: string, base: string, text: string): void {
  mkdirSync(directory, { recursive: true });
  const name = uniqueName(directory, sanitizeName(base), ".md");
  writeFileSync(join(directory, name), text);
}

function writeMarker(markerPath: string, imported: number): void {
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, JSON.stringify({ migratedAt: new Date().toISOString(), imported }, null, 2));
}

function listJsonFiles(directory: string): string[] {
  try {
    return readdirSync(directory).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}

interface LegacyFolder {
  readonly id: string;
  readonly name: string;
  readonly parentId?: string | null;
}

function readLegacyFolders(path: string): LegacyFolder[] {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { folders?: unknown };
    if (!Array.isArray(raw.folders)) return [];
    return raw.folders.filter(
      (folder): folder is LegacyFolder =>
        typeof folder === "object" &&
        folder !== null &&
        typeof (folder as LegacyFolder).id === "string" &&
        typeof (folder as LegacyFolder).name === "string",
    );
  } catch {
    return [];
  }
}

interface LegacyDocument {
  readonly text: string;
  readonly parentId?: string | null;
}

function readLegacyDocument(path: string): LegacyDocument | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      text?: unknown;
      parentId?: unknown;
    };
    if (typeof raw.text !== "string") return null;
    return {
      text: raw.text,
      parentId: typeof raw.parentId === "string" ? raw.parentId : null,
    };
  } catch {
    return null; // Truncated or corrupt: not worth importing.
  }
}
