import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocumentRoutes } from "../../src/server/features/documents/index.ts";
import { createFilesystemLibrary } from "../../src/server/features/library/index.ts";
import { deriveTitle } from "../../src/shared/documents.ts";
import { Logger } from "../../src/logging/logger.ts";
import type { Transport } from "../../src/logging/transport.ts";

const silent: Transport = { name: "silent", write: () => {} };
const logger = new Logger({ level: "error", transports: [silent] });

function tempRoutes() {
  const root = mkdtempSync(join(tmpdir(), "textpilot-docs-"));
  const library = createFilesystemLibrary({ root, logger });
  const routes = createDocumentRoutes({ store: library.documents, logger });
  return { routes, root, library };
}

function markdownFiles(directory: string): string[] {
  return readdirSync(directory).filter((name) => name.endsWith(".md"));
}

async function createDocument(routes: ReturnType<typeof createDocumentRoutes>, body: unknown) {
  const response = await routes.request("/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json()) as { id: string; title: string; parentId: string | null };
}

describe("documents api", () => {
  test("GET /api/documents starts empty on first launch", async () => {
    const { routes } = tempRoutes();
    const res = await routes.request("/documents");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ documents: [] });
  });

  test("POST /api/documents creates a .md file and lists it", async () => {
    const { routes, root } = tempRoutes();
    const created = await createDocument(routes, { text: "# Shopping List\n\n- apples" });
    expect(created.id).toBeTruthy();
    expect(created.title).toBe("Shopping List");
    expect(markdownFiles(root)).toEqual(["Shopping List.md"]);

    const list = await routes.request("/documents");
    const body = (await list.json()) as { documents: { id: string }[] };
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0]!.id).toBe(created.id);
  });

  test("POST /api/documents without a body creates an untitled document", async () => {
    const { routes } = tempRoutes();
    const created = await createDocument(routes, {});
    expect(created.title).toBe("Untitled");
  });

  test("a long first line names the file without a display ellipsis", async () => {
    const { routes } = tempRoutes();
    const created = await createDocument(routes, {
      text: `# ${'Lorem ipsum dolor sit amet, consetetur sadipscing elitr '.repeat(4).trim()}`,
    });
    expect(created.title).not.toContain("…");
    expect(created.title.length).toBeLessThanOrEqual(100);
  });

  test("a second document with the same name does not overwrite the first", async () => {
    const { routes } = tempRoutes();
    await createDocument(routes, { text: "# Notes" });
    await createDocument(routes, { text: "# Notes" });

    const list = await routes.request("/documents");
    const body = (await list.json()) as { documents: { title: string }[] };
    expect(body.documents.map((d) => d.title).sort()).toEqual(["Notes", "Notes 2"]);
  });

  test("PUT /api/documents/:id saves the text; the filename stays the title", async () => {
    const { routes } = tempRoutes();
    const created = await createDocument(routes, { text: "# Untouched" });

    const markdown = "# Renamed by editing\n\nBody.";
    const put = await routes.request(`/documents/${created.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: markdown }),
    });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { text: string }).text).toBe(markdown);

    const get = await routes.request(`/documents/${created.id}`);
    const body = (await get.json()) as { title: string; text: string };
    // Editing the first line renames nothing: the filename is the title.
    expect(body.title).toBe("Untouched");
    expect(body.text).toBe(markdown);
  });

  test("GET /api/documents/:id 404s for a missing document", async () => {
    const { routes } = tempRoutes();
    const res = await routes.request("/documents/nope");
    expect(res.status).toBe(404);
  });

  test("path traversal in :id is rejected, not served", async () => {
    const { routes } = tempRoutes();
    const res = await routes.request("/documents/..%2F..%2Fnote");
    expect(res.status).toBe(400);
  });

  test("PUT rejects a non-string text and oversized documents", async () => {
    const { routes } = tempRoutes();
    const bad = await routes.request("/documents/some-id", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: 42 }),
    });
    expect(bad.status).toBe(400);

    const big = await routes.request("/documents/some-id", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "x".repeat(2_100_000) }),
    });
    expect(big.status).toBe(413);
  });

  test("PATCH with a title renames the file and returns the new id", async () => {
    const { routes, root } = tempRoutes();
    const created = await createDocument(routes, { text: "# Old name" });

    const renamed = await routes.request(`/documents/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "My custom name" }),
    });
    expect(renamed.status).toBe(200);
    const record = (await renamed.json()) as { id: string; title: string };
    expect(record.title).toBe("My custom name");
    expect(record.id).not.toBe(created.id);
    expect(markdownFiles(root)).toEqual(["My custom name.md"]);

    // A later content save through the new id must not clobber the name.
    await routes.request(`/documents/${record.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "# New heading content" }),
    });
    const get = await routes.request(`/documents/${record.id}`);
    expect(((await get.json()) as { title: string }).title).toBe("My custom name");
  });

  test("moving a document keeps its name and reports its new folder", async () => {
    const { routes, library } = tempRoutes();
    const created = await createDocument(routes, { text: "# Original heading" });
    const folder = await library.folders.create("Projects");

    const moved = await routes.request(`/documents/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId: folder.id }),
    });
    expect(moved.status).toBe(200);
    const record = (await moved.json()) as { id: string; title: string; parentId: string | null };
    expect(record.title).toBe("Original heading");
    expect(record.parentId).toBe(folder.id);
    expect(record.id).not.toBe(created.id);
  });

  test("a malformed parentId is rejected rather than stored", async () => {
    const { routes } = tempRoutes();
    const created = await createDocument(routes, {});

    const malformed = await routes.request(`/documents/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId: "../../etc/passwd" }),
    });
    expect(malformed.status).toBe(400);

    const wrongType = await routes.request(`/documents/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId: 7 }),
    });
    expect(wrongType.status).toBe(400);
  });

  test("documents persist as files that a new store instance reads", async () => {
    const root = mkdtempSync(join(tmpdir(), "textpilot-docs-"));
    const first = createFilesystemLibrary({ root, logger });
    const created = await first.documents.create("# Persisted\n");

    const second = createFilesystemLibrary({ root, logger });
    const loaded = await second.documents.load(created.id);
    expect(loaded.text).toBe("# Persisted\n");
    expect(markdownFiles(root)).toHaveLength(1);
  });

  test("DELETE /api/documents/:id removes the document and its file", async () => {
    const { routes, root } = tempRoutes();
    const created = await createDocument(routes, {});

    const del = await routes.request(`/documents/${created.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);

    const get = await routes.request(`/documents/${created.id}`);
    expect(get.status).toBe(404);
    const list = await routes.request("/documents");
    expect(((await list.json()) as { documents: unknown[] }).documents).toHaveLength(0);
    expect(markdownFiles(root)).toHaveLength(0);
  });

  test("DELETE /api/documents/:id 404s for a missing document", async () => {
    const { routes } = tempRoutes();
    const res = await routes.request("/documents/nope", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  test("deleting one document leaves the others intact", async () => {
    const { routes } = tempRoutes();
    const a = await createDocument(routes, { text: "# A" });
    const b = await createDocument(routes, { text: "# B" });

    await routes.request(`/documents/${a.id}`, { method: "DELETE" });

    const get = await routes.request(`/documents/${b.id}`);
    expect(get.status).toBe(200);
    const list = await routes.request("/documents");
    const body = (await list.json()) as { documents: { id: string }[] };
    expect(body.documents.map((d) => d.id)).toEqual([b.id]);
  });

  test("files that are not Markdown are left out of the list", async () => {
    const { routes, root } = tempRoutes();
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(root, "notes.txt"), "not a document");

    const list = await routes.request("/documents");
    expect(((await list.json()) as { documents: unknown[] }).documents).toHaveLength(0);
  });
});

describe("deriveTitle", () => {
  test("uses the first non-empty line, markdown stripped", () => {
    expect(deriveTitle("# Heading first")).toBe("Heading first");
    expect(deriveTitle("\n\n**bold** line")).toBe("bold line");
    expect(deriveTitle("plain text")).toBe("plain text");
  });

  test("falls back to Untitled for empty documents", () => {
    expect(deriveTitle("")).toBe("Untitled");
    expect(deriveTitle("\n  \n")).toBe("Untitled");
  });

  test("keeps the whole first line - length is the filesystem's business", () => {
    const title = deriveTitle("x".repeat(200));
    expect(title).toBe("x".repeat(200));
    expect(title).not.toContain("…");
  });
});
