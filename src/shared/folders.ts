/**
 * Folders and tree structure, shared by server and renderer.
 *
 * A folder is a real directory in the library, so it is a light record:
 * id, parent, display name. Documents point at their folder through
 * `parentId` (null = the library root). There is no ordering field - the
 * filesystem has none - so siblings sort by name, folders ahead of
 * documents, the way a file manager shows them.
 */
import type { DocumentMeta } from "./documents.ts";

export interface FolderMeta {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
}

/** A document as the tree sees it: metadata plus its tree placement. */
export type TreeDocument = DocumentMeta & {
  readonly parentId: string | null;
};

/** One flattened sidebar row: either a folder or a document. */
export type TreeEntry =
  | { readonly kind: "folder"; readonly folder: FolderMeta; readonly depth: number }
  | { readonly kind: "document"; readonly document: TreeDocument; readonly depth: number };

/** Case-insensitive name order, so `apple` and `Apple` sit together. */
function byName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/**
 * Depth-first ordering of the tree, the order the sidebar renders.
 * Folders and documents sit together at each level, folders first, each
 * group alphabetical; children render directly under their folder.
 * Cycles (a hand-made symlink loop, say) are cut: a node already on the
 * ancestor path is skipped.
 */
export function orderTree(folders: FolderMeta[], documents: TreeDocument[]): TreeEntry[] {
  const entries: TreeEntry[] = [];
  const visited = new Set<string>();

  function walk(parentId: string | null, depth: number, ancestors: Set<string>): void {
    const childFolders = folders
      .filter((folder) => (folder.parentId ?? null) === parentId)
      .sort((a, b) => byName(a.name, b.name));
    const childDocs = documents
      .filter((document) => (document.parentId ?? null) === parentId)
      .sort((a, b) => byName(a.title, b.title));

    for (const folder of childFolders) {
      if (ancestors.has(folder.id)) continue; // cycle guard
      entries.push({ kind: "folder", folder, depth });
      visited.add(folder.id);
      walk(folder.id, depth + 1, new Set(ancestors).add(folder.id));
    }
    for (const document of childDocs) {
      entries.push({ kind: "document", document, depth });
      visited.add(document.id);
    }
  }

  walk(null, 0, new Set());

  // Orphans (parent missing/cyclic) still deserve to be visible.
  for (const folder of folders) {
    if (!visited.has(folder.id)) entries.push({ kind: "folder", folder, depth: 0 });
  }
  for (const document of documents) {
    if (!visited.has(document.id)) entries.push({ kind: "document", document, depth: 0 });
  }
  return entries;
}

/**
 * The ids of a folder and every folder under it.
 *
 * One implementation for the places that need the answer - the sidebar's
 * drag guard is the caller today - so a subtree can never be defined two
 * ways. The parent map makes the walk proportional to the subtree, not
 * to subtree × folders. Cycles are cut rather than followed twice.
 */
export function descendantIds(folders: FolderMeta[], id: string): Set<string> {
  const byParent = new Map<string, FolderMeta[]>();
  for (const folder of folders) {
    const key = folder.parentId ?? "";
    const children = byParent.get(key);
    if (children) children.push(folder);
    else byParent.set(key, [folder]);
  }

  const ids = new Set<string>([id]);
  const queue = [id];
  while (queue.length > 0) {
    for (const child of byParent.get(queue.pop()!) ?? []) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      queue.push(child.id);
    }
  }
  return ids;
}

/** `descendantIds` as a list, for callers that want an array. */
export function subtreeIds(folders: FolderMeta[], id: string): string[] {
  return [...descendantIds(folders, id)];
}
