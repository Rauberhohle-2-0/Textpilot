/**
 * Document storage: one JSON file per document under the data directory.
 *
 * Files are the point - a document is a file the user can back up, and
 * adding one is creating a file, not extending a schema. Writes go
 * through a sibling temp file and rename, the same atomic pattern the
 * single-note store uses. The interface is the seam: a SQLite-backed
 * implementation replaces this without the routes or UI noticing.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deriveTitle, type DocumentMeta, type DocumentRecord } from "../../../shared/documents.ts";
import type { Logger } from "../../../logging/logger.ts";

export interface DocumentStore {
  list(): Promise<DocumentMeta[]>;
  create(text?: string, parentId?: string | null): Promise<DocumentRecord>;
  load(id: string): Promise<DocumentRecord>;
  save(id: string, text: string): Promise<DocumentRecord>;
  /** Remove the document's file; false when there was nothing to remove. */
  delete(id: string): Promise<boolean>;
  /** Move a document into a folder (null = root) at a position. */
  move(id: string, parentId: string | null, position: number): Promise<DocumentRecord>;
  /** Set an explicit title, overriding the derived one. */
  rename(id: string, title: string): Promise<DocumentRecord>;
}

export interface FileDocumentStoreOptions {
  /** Directory holding one JSON file per document; created if missing. */
  directory: string;
  /** Markdown persisted at first boot, when no documents exist yet. */
  seedText?: string;
  logger?: Logger;
}

export function createFileDocumentStore({
  directory,
  seedText,
  logger,
}: FileDocumentStoreOptions): DocumentStore {
  const log = logger?.child("documents");

  function existingIds(): string[] {
    try {
      return readdirSync(directory).filter((name) => name.endsWith(".json"));
    } catch {
      return [];
    }
  }

  function pathFor(id: string): string {
    // Only plain ids ever leave this module, but a route input must
    // never traverse out of the directory.
    if (!/^[a-z0-9-]+$/i.test(id)) throw new Error(`invalid document id: ${id}`);
    return join(directory, `${id}.json`);
  }

  function read(id: string): DocumentRecord | null {
    try {
      const raw = JSON.parse(readFileSync(pathFor(id), "utf8")) as Partial<DocumentRecord> & {
        parentId?: unknown;
        position?: unknown;
        titleOverride?: unknown;
      };
      if (typeof raw.text !== "string" || typeof raw.updatedAt !== "string") {
        throw new Error("malformed document file");
      }
      return {
        id,
        text: raw.text,
        updatedAt: raw.updatedAt,
        title: typeof raw.titleOverride === "string" ? raw.titleOverride : deriveTitle(raw.text),
        parentId: typeof raw.parentId === "string" ? raw.parentId : null,
        position: typeof raw.position === "number" ? raw.position : 0,
      };
    } catch {
      return null;
    }
  }

  function write(
    id: string,
    text: string,
    parentId: string | null,
    position: number,
    titleOverride?: string,
  ): DocumentRecord {
    const record: DocumentRecord = {
      id,
      text,
      title: titleOverride ?? deriveTitle(text),
      updatedAt: new Date().toISOString(),
      parentId,
      position,
    };
    mkdirSync(directory, { recursive: true });
    // Write to a sibling then rename, so a crash mid-write cannot
    // corrupt the file the next launch reads.
    const path = pathFor(id);
    const temp = `${path}.tmp`;
    writeFileSync(temp, JSON.stringify({ ...record, titleOverride: titleOverride ?? null }, null, 2));
    renameSync(temp, path);
    return record;
  }

  /** Placement of an existing document, for rewrites that must not lose it. */
  function placementOf(id: string): {
    parentId: string | null;
    position: number;
    titleOverride: string | undefined;
  } {
    let titleOverride: string | undefined;
    try {
      const raw = JSON.parse(readFileSync(pathFor(id), "utf8")) as { titleOverride?: unknown };
      if (typeof raw.titleOverride === "string") titleOverride = raw.titleOverride;
    } catch {
      // No file or unreadable: nothing to preserve.
    }
    const existing = read(id);
    return existing
      ? { parentId: existing.parentId ?? null, position: existing.position ?? 0, titleOverride }
      : { parentId: null, position: 0, titleOverride: undefined };
  }

  return {
    async list() {
      const documents = existingIds()
        .map((name) => read(name.slice(0, -".json".length)))
        .filter((record): record is DocumentRecord => record !== null)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      log?.debug("documents listed", { count: documents.length });
      return documents.map(({ id, title, updatedAt, parentId, position }) => ({
        id,
        title,
        updatedAt,
        parentId,
        position,
      }));
    },

    async create(text = "", parentId = null) {
      mkdirSync(directory, { recursive: true });
      const id = crypto.randomUUID();
      const siblings = existingIds()
        .map((name) => read(name.slice(0, -".json".length)))
        .filter((record): record is DocumentRecord => record !== null)
        .filter((record) => (record.parentId ?? null) === parentId);
      const position =
        siblings.length > 0 ? Math.max(...siblings.map((r) => r.position ?? 0)) + 1024 : 0;
      const record = write(id, text, parentId, position);
      log?.info("document created", { id });
      return record;
    },

    async load(id) {
      const record = read(id);
      if (!record) throw new Error(`document not found: ${id}`);
      return record;
    },

    async save(id, text) {
      const place = placementOf(id);
      const record = write(id, text, place.parentId, place.position, place.titleOverride);
      log?.debug("document saved", { id, bytes: text.length });
      return record;
    },

    async delete(id) {
      try {
        rmSync(pathFor(id));
        log?.info("document deleted", { id });
        return true;
      } catch {
        return false; // Absent already: deletion is idempotent.
      }
    },

    async move(id, parentId, position) {
      const existing = read(id);
      if (!existing) throw new Error(`document not found: ${id}`);
      const record = write(id, existing.text, parentId, position);
      log?.info("document moved", { id, parentId, position });
      return record;
    },

    async rename(id, title) {
      const existing = read(id);
      if (!existing) throw new Error(`document not found: ${id}`);
      // The override is stored inside the text file's JSON, alongside
      // everything else - one file per document stays true.
      const record = write(id, existing.text, existing.parentId ?? null, existing.position ?? 0, title);
      log?.info("document renamed", { id, title });
      return record;
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  };
}

/** Remove the seed note.json when it has been migrated to a document. */
export function removeSeedNote(notePath: string): void {
  try {
    rmSync(notePath);
  } catch {
    // Absent or locked: nothing to migrate, nothing to clean.
  }
}
