/**
 * Folders and tree structure, shared by server and renderer.
 *
 * A folder is a light record: id, parent, display name. Documents point
 * at their folder through `parentId` (null = root level). Ordering
 * within a level is a float `position` - dragging between two siblings
 * picks the midpoint, so a reorder never rewrites every row.
 */
import type { DocumentMeta } from "./documents.ts";

export interface FolderMeta {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly position: number;
}

/** A document as the tree sees it: metadata plus its tree placement. */
export type TreeDocument = DocumentMeta & {
  readonly parentId: string | null;
  readonly position: number;
};

/** One flattened sidebar row: either a folder or a document. */
export type TreeEntry =
  | { readonly kind: "folder"; readonly folder: FolderMeta; readonly depth: number }
  | { readonly kind: "document"; readonly document: TreeDocument; readonly depth: number };

export interface FolderListPayload {
  readonly folders: FolderMeta[];
}

/**
 * Depth-first ordering of the tree, the order the sidebar renders.
 * Folders and documents interleave at each level by `position`; children
 * render directly under their folder. Cycles (corrupt data) are cut:
 * a node already on the ancestor path is skipped.
 */
export function orderTree(folders: FolderMeta[], documents: TreeDocument[]): TreeEntry[] {
  const entries: TreeEntry[] = [];
  const visited = new Set<string>();

  function walk(parentId: string | null, depth: number, ancestors: Set<string>): void {
    const childFolders = folders
      .filter((folder) => (folder.parentId ?? null) === parentId)
      .sort((a, b) => a.position - b.position);
    const childDocs = documents
      .filter((document) => (document.parentId ?? null) === parentId)
      .sort((a, b) => a.position - b.position);

    const merged: { position: number; emit(): void }[] = [
      ...childFolders.map((folder) => ({
        position: folder.position,
        emit: () => {
          if (ancestors.has(folder.id)) return; // cycle guard
          entries.push({ kind: "folder", folder, depth });
          visited.add(folder.id);
          walk(folder.id, depth + 1, new Set(ancestors).add(folder.id));
        },
      })),
      ...childDocs.map((document) => ({
        position: document.position,
        emit: () => {
          entries.push({ kind: "document", document, depth });
          visited.add(document.id);
        },
      })),
    ].sort((a, b) => a.position - b.position);

    for (const item of merged) item.emit();
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
 * The position for a drop between two siblings: the midpoint of the
 * neighbors' positions (half-steps at the ends). Collision-free for
 * thousands of single inserts; a full reindex refreshes when needed.
 */
export function positionBetween(before: number | null, after: number | null): number {
  if (before !== null && after !== null) return (before + after) / 2;
  if (before !== null) return before + 1024;
  if (after !== null) return after - 1024;
  return 0;
}
