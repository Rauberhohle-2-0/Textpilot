/**
 * The sidebar's client for the documents API.
 *
 * Like the editor's `api.ts`, the only file that knows the endpoints
 * exist; the view stays free of fetch.
 */
import type { DocumentMeta, DocumentRecord } from "../../../shared/documents.ts";
import type { FolderMeta } from "../../../shared/folders.ts";

export interface DocumentListPayload {
  readonly documents: DocumentMeta[];
}

export async function listDocuments(): Promise<DocumentMeta[]> {
  const response = await fetch("/api/documents");
  if (!response.ok) throw new Error(`list failed: ${response.status}`);
  const body = (await response.json()) as DocumentListPayload;
  return body.documents;
}

export async function listFolders(): Promise<FolderMeta[]> {
  const response = await fetch("/api/folders");
  if (!response.ok) throw new Error(`folders list failed: ${response.status}`);
  return ((await response.json()) as FolderListPayload).folders;
}

export async function createFolder(name: string, parentId: string | null = null): Promise<FolderMeta> {
  const response = await fetch("/api/folders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, parentId }),
  });
  if (!response.ok) throw new Error(`folder create failed: ${response.status}`);
  return (await response.json()) as FolderMeta;
}

export async function moveFolder(
  id: string,
  parentId: string | null,
  position: number,
): Promise<FolderMeta> {
  const response = await fetch(`/api/folders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentId, position }),
  });
  if (!response.ok) throw new Error(`folder move failed: ${response.status}`);
  return (await response.json()) as FolderMeta;
}

export async function deleteFolder(id: string): Promise<void> {
  const response = await fetch(`/api/folders/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`folder delete failed: ${response.status}`);
  }
}

export async function moveDocument(
  id: string,
  parentId: string | null,
  position: number,
): Promise<void> {
  const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parentId, position }),
  });
  if (!response.ok) throw new Error(`document move failed: ${response.status}`);
}

export async function renameDocument(id: string, title: string): Promise<void> {
  const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) throw new Error(`document rename failed: ${response.status}`);
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const response = await fetch(`/api/folders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(`folder rename failed: ${response.status}`);
}

export async function createDocument(text = "", parentId: string | null = null): Promise<DocumentRecord> {
  const response = await fetch("/api/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, parentId }),
  });
  if (!response.ok) throw new Error(`create failed: ${response.status}`);
  return (await response.json()) as DocumentRecord;
}

interface FolderListPayload {
  readonly folders: FolderMeta[];
}

export async function loadDocument(id: string): Promise<DocumentRecord> {
  const response = await fetch(`/api/documents/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`load failed: ${response.status}`);
  return (await response.json()) as DocumentRecord;
}

export async function deleteDocument(id: string): Promise<void> {
  const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`delete failed: ${response.status}`);
  }
}
