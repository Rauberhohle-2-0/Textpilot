/**
 * The renderer's client for the documents API - the one place that knows
 * the endpoints exist. The editor and the sidebar both read through it,
 * so a route or payload change is a change in one file.
 *
 * `text` carries the document as Markdown: the format of record, so any
 * markdown reader can consume what this app saves.
 */
import type { DocumentMeta, DocumentRecord } from "../../shared/documents.ts";
import { fetchJson, fetchVoid, jsonBody } from "./request.ts";

interface DocumentListPayload {
  readonly documents: DocumentMeta[];
}

export async function listDocuments(): Promise<DocumentMeta[]> {
  const body = await fetchJson<DocumentListPayload>("/api/documents", "list");
  return body.documents;
}

export async function createDocument(
  text = "",
  parentId: string | null = null,
): Promise<DocumentRecord> {
  return await fetchJson<DocumentRecord>(
    "/api/documents",
    "create",
    jsonBody("POST", { text, parentId }),
  );
}

export async function loadDocument(id: string): Promise<DocumentRecord> {
  return await fetchJson<DocumentRecord>(`/api/documents/${encodeURIComponent(id)}`, "load");
}

export async function saveDocument(id: string, markdown: string): Promise<DocumentRecord> {
  return await fetchJson<DocumentRecord>(
    `/api/documents/${encodeURIComponent(id)}`,
    "save",
    jsonBody("PUT", { text: markdown }),
  );
}

/**
 * Move a document into a folder (null = root). The returned record
 * carries the document's new id, because the id is its path.
 */
export async function moveDocument(
  id: string,
  parentId: string | null,
): Promise<DocumentRecord> {
  return await fetchJson<DocumentRecord>(
    `/api/documents/${encodeURIComponent(id)}`,
    "document move",
    jsonBody("PATCH", { parentId }),
  );
}

/** Rename the document's file; the filename is the title. */
export async function renameDocument(id: string, title: string): Promise<DocumentRecord> {
  return await fetchJson<DocumentRecord>(
    `/api/documents/${encodeURIComponent(id)}`,
    "document rename",
    jsonBody("PATCH", { title }),
  );
}

/** Deleting an already-absent document is not a failure. */
export async function deleteDocument(id: string): Promise<void> {
  await fetchVoid(`/api/documents/${encodeURIComponent(id)}`, "delete", { method: "DELETE" }, [404]);
}

/**
 * The document to open at boot: the most recently edited one, or a
 * fresh document on first launch - never an empty screen with no
 * document behind it.
 *
 * The sidebar resolves this *before* it lists the tree, so the document
 * a first launch creates is part of that first list. Creating it from
 * the editor instead used to leave an invisible file on disk that the
 * sidebar never showed and the writer was silently typing into.
 */
export async function resolveActiveDocument(): Promise<DocumentRecord> {
  const documents = await listDocuments();
  if (documents.length === 0) return createDocument();
  return loadDocument(documents[0]!.id);
}
