/**
 * The renderer's client for the folders API - the sibling of the
 * documents client, for the tree's folder half. The sidebar is the only
 * caller today; it is its own module because folders are their own
 * server feature with their own endpoints.
 */
import type { FolderMeta } from "../../shared/folders.ts";
import { fetchJson, fetchVoid, jsonBody } from "./request.ts";

interface FolderListPayload {
  readonly folders: FolderMeta[];
}

export async function listFolders(): Promise<FolderMeta[]> {
  const body = await fetchJson<FolderListPayload>("/api/folders", "folders list");
  return body.folders;
}

export async function createFolder(
  name: string,
  parentId: string | null = null,
): Promise<FolderMeta> {
  return await fetchJson<FolderMeta>("/api/folders", "folder create", jsonBody("POST", { name, parentId }));
}

/**
 * Move a folder (and thereby its subtree) under a new parent. The
 * returned record carries the folder's new id, because the id is its
 * path.
 */
export async function moveFolder(id: string, parentId: string | null): Promise<FolderMeta> {
  return await fetchJson<FolderMeta>(
    `/api/folders/${encodeURIComponent(id)}`,
    "folder move",
    jsonBody("PATCH", { parentId }),
  );
}

export async function renameFolder(id: string, name: string): Promise<FolderMeta> {
  return await fetchJson<FolderMeta>(
    `/api/folders/${encodeURIComponent(id)}`,
    "folder rename",
    jsonBody("PATCH", { name }),
  );
}

/** Deleting an already-absent folder is not a failure. */
export async function deleteFolder(id: string): Promise<void> {
  await fetchVoid(`/api/folders/${encodeURIComponent(id)}`, "folder delete", { method: "DELETE" }, [404]);
}
