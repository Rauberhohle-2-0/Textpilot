/**
 * The editor's client for the documents API.
 *
 * The only file that knows the endpoints exist. The view and store stay
 * free of fetch, so the persistence layer can change without touching UI.
 * `text` carries the document as Markdown: the format of record is
 * markdown, so any markdown reader can consume saved notes.
 */
import type { DocumentMeta, DocumentRecord } from "../../../shared/documents.ts";

export interface DocumentListPayload {
  readonly documents: DocumentMeta[];
}

export async function listDocuments(): Promise<DocumentMeta[]> {
  const response = await fetch("/api/documents");
  if (!response.ok) throw new Error(`list failed: ${response.status}`);
  return ((await response.json()) as DocumentListPayload).documents;
}

export async function createDocument(text = ""): Promise<DocumentRecord> {
  const response = await fetch("/api/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error(`create failed: ${response.status}`);
  return (await response.json()) as DocumentRecord;
}

export async function loadDocument(id: string): Promise<DocumentRecord> {
  const response = await fetch(`/api/documents/${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`load failed: ${response.status}`);
  return (await response.json()) as DocumentRecord;
}

export async function saveDocument(id: string, markdown: string): Promise<DocumentRecord> {
  const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: markdown }),
  });
  if (!response.ok) throw new Error(`save failed: ${response.status}`);
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

/**
 * The document the editor opens at boot: the most recently edited one,
 * or a fresh document on first launch - never an empty screen with no
 * document behind it.
 */
export async function resolveActiveDocument(): Promise<DocumentRecord> {
  const documents = await listDocuments();
  if (documents.length === 0) return createDocument();
  return loadDocument(documents[0]!.id);
}
