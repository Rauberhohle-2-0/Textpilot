/**
 * Folder storage: one JSON file holding every folder.
 *
 * Folders are few - tens, not thousands - so a single file written
 * atomically (temp + rename, same pattern as the documents) is simpler
 * than per-folder files, and reads are one synchronous parse.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { FolderMeta } from "../../../shared/folders.ts";
import type { Logger } from "../../../logging/logger.ts";

export interface FolderStore {
  list(): Promise<FolderMeta[]>;
  create(name: string, parentId?: string | null): Promise<FolderMeta>;
  rename(id: string, name: string): Promise<FolderMeta>;
  /** Move a folder (and thereby its subtree) under a new parent. */
  move(id: string, parentId: string | null, position: number): Promise<FolderMeta>;
  delete(id: string): Promise<boolean>;
}

export interface FileFolderStoreOptions {
  /** The JSON file holding all folders. */
  path: string;
  logger?: Logger;
}

interface FolderFile {
  readonly folders: FolderMeta[];
}

export function createFileFolderStore({ path, logger }: FileFolderStoreOptions): FolderStore {
  const log = logger?.child("folders");

  function readAll(): FolderMeta[] {
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<FolderFile>;
      return Array.isArray(raw.folders) ? raw.folders : [];
    } catch {
      return []; // Missing or unreadable: no folders yet.
    }
  }

  function writeAll(folders: FolderMeta[]): void {
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.tmp`;
    writeFileSync(temp, JSON.stringify({ folders }, null, 2));
    renameSync(temp, path);
  }

  /**
   * Would moving `id` under `newParent` create a cycle? A folder can
   * never move inside itself or one of its descendants.
   */
  function wouldCycle(folders: FolderMeta[], id: string, newParent: string | null): boolean {
    if (newParent === null) return false;
    let current: string | null = newParent;
    while (current !== null) {
      if (current === id) return true;
      const parent = folders.find((folder) => folder.id === current);
      current = parent?.parentId ?? null;
    }
    return false;
  }

  return {
    async list() {
      return readAll();
    },

    async create(name, parentId = null) {
      const folders = readAll();
      if (parentId !== null && !folders.some((folder) => folder.id === parentId)) {
        throw new Error(`parent folder not found: ${parentId}`);
      }
      const siblings = folders.filter((folder) => (folder.parentId ?? null) === parentId);
      const position = siblings.length > 0 ? Math.max(...siblings.map((f) => f.position)) + 1024 : 0;
      const folder: FolderMeta = { id: randomUUID(), parentId, name, position };
      writeAll([...folders, folder]);
      log?.info("folder created", { id: folder.id, name });
      return folder;
    },

    async rename(id, name) {
      const folders = readAll();
      const folder = folders.find((entry) => entry.id === id);
      if (!folder) throw new Error(`folder not found: ${id}`);
      const renamed = { ...folder, name };
      writeAll(folders.map((entry) => (entry.id === id ? renamed : entry)));
      log?.info("folder renamed", { id, name });
      return renamed;
    },

    async move(id, parentId, position) {
      const folders = readAll();
      const folder = folders.find((entry) => entry.id === id);
      if (!folder) throw new Error(`folder not found: ${id}`);
      if (parentId !== null && !folders.some((entry) => entry.id === parentId)) {
        throw new Error(`parent folder not found: ${parentId}`);
      }
      if (wouldCycle(folders, id, parentId)) {
        throw new Error("cannot move a folder into its own subtree");
      }
      const moved = { ...folder, parentId, position };
      writeAll(folders.map((entry) => (entry.id === id ? moved : entry)));
      log?.info("folder moved", { id, parentId, position });
      return moved;
    },

    async delete(id) {
      const folders = readAll();
      const doomed = new Set<string>([id]);
      // A folder's children (folders and, via routes, their documents)
      // go with it: collect the whole subtree.
      let grew = true;
      while (grew) {
        grew = false;
        for (const folder of folders) {
          if (folder.parentId !== null && doomed.has(folder.parentId) && !doomed.has(folder.id)) {
            doomed.add(folder.id);
            grew = true;
          }
        }
      }
      const remaining = folders.filter((folder) => !doomed.has(folder.id));
      if (remaining.length === folders.length) return false;
      writeAll(remaining);
      log?.info("folder deleted", { id, withDescendants: [...doomed] });
      return true;
    },
  };
}

/** The ids of the folder and all its descendant folders. */
export function subtreeIds(folders: FolderMeta[], id: string): string[] {
  const doomed = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId !== null && doomed.has(folder.parentId) && !doomed.has(folder.id)) {
        doomed.add(folder.id);
        grew = true;
      }
    }
  }
  return [...doomed];
}
