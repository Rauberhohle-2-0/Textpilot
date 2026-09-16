import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFileDocumentStore,
  createDocumentRoutes,
} from "../../src/server/features/documents/index.ts";
import {
  createFileFolderStore,
  createFolderRoutes,
  subtreeIds,
} from "../../src/server/features/folders/index.ts";
import type { FolderMeta } from "../../src/shared/folders.ts";
import { Logger } from "../../src/logging/logger.ts";
import type { Transport } from "../../src/logging/transport.ts";

const silent: Transport = { name: "silent", write: () => {} };
const logger = new Logger({ level: "error", transports: [silent] });

function tempHarness() {
  const directory = mkdtempSync(join(tmpdir(), "textpilot-folders-"));
  const documentStore = createFileDocumentStore({ directory, logger });
  const folderStore = createFileFolderStore({ path: join(directory, "folders.json"), logger });
  const app = createFolderRoutes({
    store: folderStore,
    documentStore,
    documentsDirectory: directory,
    logger,
  });
  const docRoutes = createDocumentRoutes({ store: documentStore, logger });
  return { directory, documentStore, folderStore, app, docRoutes };
}

describe("folders api", () => {
  test("POST /api/folders creates and GET lists", async () => {
    const { app } = tempHarness();
    const post = await app.request("/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Projects" }),
    });
    expect(post.status).toBe(201);
    const created = (await post.json()) as FolderMeta;
    expect(created.name).toBe("Projects");
    expect(created.parentId).toBeNull();

    const list = await app.request("/folders");
    expect(((await list.json()) as { folders: FolderMeta[] }).folders).toHaveLength(1);
  });

  test("nested folders: parentId chains and moves with cycle prevention", async () => {
    const { app } = tempHarness();
    const a = (await (
      await app.request("/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "A" }),
      })
    ).json()) as FolderMeta;
    const b = (await (
      await app.request("/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "B", parentId: a.id }),
      })
    ).json()) as FolderMeta;

    // Move A under B would make B's parent its own descendant: rejected.
    const cyclic = await app.request(`/folders/${a.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId: b.id, position: 0 }),
    });
    expect(cyclic.status).toBe(400);

    // Moving A to root explicitly is fine.
    const moved = await app.request(`/folders/${a.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId: null, position: 5 }),
    });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as FolderMeta).position).toBe(5);
  });

  test("documents can be moved into a folder and report their parentId", async () => {
    const { app, docRoutes, documentStore } = tempHarness();
    const folder = (await (
      await app.request("/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Inbox" }),
      })
    ).json()) as FolderMeta;

    const doc = (await (
      await docRoutes.request("/documents", { method: "POST" })
    ).json()) as { id: string };

    const moved = await docRoutes.request(`/documents/${doc.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parentId: folder.id, position: 1.5 }),
    });
    expect(moved.status).toBe(200);
    const body = (await moved.json()) as { parentId: string | null; position: number };
    expect(body.parentId).toBe(folder.id);
    expect(body.position).toBe(1.5);

    const reloaded = await documentStore.load(doc.id);
    expect(reloaded.parentId).toBe(folder.id);
  });

  test("deleting a folder cascades: child folders and their documents go too", async () => {
    const { app, docRoutes, directory, documentStore } = tempHarness();
    const parent = (await (
      await app.request("/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Parent" }),
      })
    ).json()) as FolderMeta;
    const child = (await (
      await app.request("/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Child", parentId: parent.id }),
      })
    ).json()) as FolderMeta;

    const inside = (await (
      await docRoutes.request("/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentId: child.id }),
      })
    ).json()) as { id: string };
    const outside = (await (
      await docRoutes.request("/documents", { method: "POST" })
    ).json()) as { id: string };

    const del = await app.request(`/folders/${parent.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);

    // Documents inside the subtree are gone, the outside one survives.
    expect((await docRoutes.request(`/documents/${inside.id}`)).status).toBe(404);
    expect((await docRoutes.request(`/documents/${outside.id}`)).status).toBe(200);
    expect((await documentStore.load(outside.id)).parentId).toBeNull();

    const list = await app.request("/folders");
    expect(((await list.json()) as { folders: FolderMeta[] }).folders).toHaveLength(0);
    // The surviving document file plus folders.json itself.
    expect(readdirSync(directory).filter((name) => name.endsWith(".json"))).toHaveLength(2);
  });

  test("DELETE a missing folder 404s", async () => {
    const { app } = tempHarness();
    expect((await app.request("/folders/nope", { method: "DELETE" })).status).toBe(404);
  });
});

describe("subtreeIds", () => {
  test("collects the folder and all descendants", () => {
    const folders: FolderMeta[] = [
      { id: "a", parentId: null, name: "A", position: 0 },
      { id: "b", parentId: "a", name: "B", position: 0 },
      { id: "c", parentId: "b", name: "C", position: 0 },
      { id: "d", parentId: null, name: "D", position: 0 },
    ];
    expect(subtreeIds(folders, "a").sort()).toEqual(["a", "b", "c"]);
    expect(subtreeIds(folders, "d")).toEqual(["d"]);
  });
});

describe("orderTree", () => {
  test("interleaves folders and documents by position, depth-first", async () => {
    const { orderTree } = await import("../../src/shared/folders.ts");
    const folders: FolderMeta[] = [{ id: "f1", parentId: null, name: "F", position: 5 }];
    const documents = [
      { id: "d1", title: "First", updatedAt: "", parentId: null, position: 1 },
      { id: "d2", title: "Inside", updatedAt: "", parentId: "f1", position: 0 },
      { id: "d3", title: "Last", updatedAt: "", parentId: null, position: 9 },
    ];
    const entries = orderTree(folders, documents);
    expect(entries.map((entry) => (entry.kind === "folder" ? entry.folder.id : entry.document.id))).toEqual([
      "d1",
      "f1",
      "d2",
      "d3",
    ]);
    const inside = entries.find((entry) => entry.kind === "document" && entry.document.id === "d2");
    expect(inside && "depth" in inside ? inside.depth : -1).toBe(1);
  });

  test("orphans render at the root instead of vanishing", async () => {
    const { orderTree } = await import("../../src/shared/folders.ts");
    const folders: FolderMeta[] = [{ id: "x", parentId: "ghost", name: "X", position: 0 }];
    const entries = orderTree(folders, []);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.depth).toBe(0);
  });
});
