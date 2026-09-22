import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocumentRoutes } from "../../src/server/features/documents/index.ts";
import { createFolderRoutes, descendantIds, subtreeIds } from "../../src/server/features/folders/index.ts";
import { createFilesystemLibrary } from "../../src/server/features/library/index.ts";
import { orderTree } from "../../src/shared/folders.ts";
import type { FolderMeta } from "../../src/shared/folders.ts";
import { Logger } from "../../src/logging/logger.ts";
import type { Transport } from "../../src/logging/transport.ts";

const silent: Transport = { name: "silent", write: () => {} };
const logger = new Logger({ level: "error", transports: [silent] });

function tempHarness() {
  const root = mkdtempSync(join(tmpdir(), "textpilot-folders-"));
  const library = createFilesystemLibrary({ root, logger });
  const app = createFolderRoutes({ store: library.folders, logger });
  const docRoutes = createDocumentRoutes({ store: library.documents, logger });
  return { root, library, app, docRoutes };
}

const JSON_HEADERS = { "content-type": "application/json" };

describe("folders api", () => {
  test("POST /api/folders creates a directory and GET lists it", async () => {
    const { app, root } = tempHarness();
    const post = await app.request("/folders", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Projects" }),
    });
    expect(post.status).toBe(201);
    const created = (await post.json()) as FolderMeta;
    expect(created.name).toBe("Projects");
    expect(created.parentId).toBeNull();
    expect(existsSync(join(root, "Projects"))).toBe(true);

    const list = await app.request("/folders");
    expect(((await list.json()) as { folders: FolderMeta[] }).folders).toHaveLength(1);
  });

  test("nested folders: parentId chains and cycle prevention", async () => {
    const { app } = tempHarness();
    const a = (await (
      await app.request("/folders", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "A" }),
      })
    ).json()) as FolderMeta;
    const b = (await (
      await app.request("/folders", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "B", parentId: a.id }),
      })
    ).json()) as FolderMeta;

    // Moving A under B would make B's parent its own descendant: rejected.
    const cyclic = await app.request(`/folders/${a.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ parentId: b.id }),
    });
    expect(cyclic.status).toBe(400);

    // Moving A to the root explicitly is fine.
    const moved = await app.request(`/folders/${a.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ parentId: null }),
    });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as FolderMeta).parentId).toBeNull();
  });

  test("documents can be moved into a folder and report their parentId", async () => {
    const { app, docRoutes } = tempHarness();
    const folder = (await (
      await app.request("/folders", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "Inbox" }),
      })
    ).json()) as FolderMeta;

    const doc = (await (
      await docRoutes.request("/documents", { method: "POST" })
    ).json()) as { id: string };

    const moved = await docRoutes.request(`/documents/${doc.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ parentId: folder.id }),
    });
    expect(moved.status).toBe(200);
    const body = (await moved.json()) as { parentId: string | null };
    expect(body.parentId).toBe(folder.id);
  });

  test("deleting a folder removes its whole subtree from disk", async () => {
    const { app, docRoutes, root, library } = tempHarness();
    const parent = (await (
      await app.request("/folders", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "Parent" }),
      })
    ).json()) as FolderMeta;
    const child = (await (
      await app.request("/folders", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "Child", parentId: parent.id }),
      })
    ).json()) as FolderMeta;

    const inside = (await (
      await docRoutes.request("/documents", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ parentId: child.id }),
      })
    ).json()) as { id: string };
    const outside = (await (
      await docRoutes.request("/documents", { method: "POST" })
    ).json()) as { id: string };

    const del = await app.request(`/folders/${parent.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);

    // The whole directory is gone; the outside document survives.
    expect(existsSync(join(root, "Parent"))).toBe(false);
    expect((await docRoutes.request(`/documents/${inside.id}`)).status).toBe(404);
    expect((await docRoutes.request(`/documents/${outside.id}`)).status).toBe(200);

    const list = await app.request("/folders");
    expect(((await list.json()) as { folders: FolderMeta[] }).folders).toHaveLength(0);
    expect((await library.documents.list()).map((d) => d.id)).toEqual([outside.id]);
    // Only the surviving .md file is left in the library root.
    expect(readdirSync(root)).toEqual([expect.stringMatching(/\.md$/)]);
  });

  test("DELETE a missing folder 404s", async () => {
    const { app } = tempHarness();
    expect((await app.request("/folders/nope", { method: "DELETE" })).status).toBe(404);
  });

  test("a parentId that is not a folder id is rejected", async () => {
    const { app } = tempHarness();
    const malformed = await app.request("/folders", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Sneaky", parentId: "../../etc" }),
    });
    expect(malformed.status).toBe(400);

    const missing = await app.request("/folders", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Orphan", parentId: "no-such-folder" }),
    });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toContain("parent folder not found");
  });

  test("a folder id that is not an id is rejected, not looked up", async () => {
    const { app } = tempHarness();
    const res = await app.request("/folders/..%2F..%2Fetc", { method: "DELETE" });
    expect(res.status).toBe(400);
  });
});

describe("subtreeIds", () => {
  test("collects the folder and all descendants", () => {
    const folders: FolderMeta[] = [
      { id: "a", parentId: null, name: "A" },
      { id: "b", parentId: "a", name: "B" },
      { id: "c", parentId: "b", name: "C" },
      { id: "d", parentId: null, name: "D" },
    ];
    expect(subtreeIds(folders, "a").sort()).toEqual(["a", "b", "c"]);
    expect(subtreeIds(folders, "d")).toEqual(["d"]);
  });
});

describe("descendantIds", () => {
  test("returns the whole subtree, each folder once", () => {
    const folders: FolderMeta[] = [
      { id: "a", parentId: null, name: "A" },
      { id: "b", parentId: "a", name: "B" },
      { id: "c", parentId: "b", name: "C" },
      { id: "d", parentId: null, name: "D" },
    ];
    expect([...descendantIds(folders, "a")].sort()).toEqual(["a", "b", "c"]);
    expect([...descendantIds(folders, "d")]).toEqual(["d"]);
  });

  test("terminates on corrupt data: a cycle is cut, not followed", () => {
    const folders: FolderMeta[] = [
      { id: "x", parentId: "y", name: "X" },
      { id: "y", parentId: "x", name: "Y" },
    ];
    expect([...descendantIds(folders, "x")].sort()).toEqual(["x", "y"]);
  });

  test("a folder that does not exist is only itself", () => {
    expect([...descendantIds([], "ghost")]).toEqual(["ghost"]);
  });
});

describe("orderTree", () => {
  test("lists folders first, then documents, each alphabetical, depth-first", () => {
    const folders: FolderMeta[] = [
      { id: "f1", parentId: null, name: "Beta" },
      { id: "f0", parentId: null, name: "Alpha" },
    ];
    const documents = [
      { id: "d1", title: "Apple", updatedAt: "", parentId: null },
      { id: "d2", title: "Inside", updatedAt: "", parentId: "f1" },
      { id: "d3", title: "Zebra", updatedAt: "", parentId: null },
    ];
    const entries = orderTree(folders, documents);
    expect(
      entries.map((entry) => (entry.kind === "folder" ? entry.folder.id : entry.document.id)),
    ).toEqual(["f0", "f1", "d2", "d1", "d3"]);
    const inside = entries.find(
      (entry) => entry.kind === "document" && entry.document.id === "d2",
    );
    expect(inside?.depth ?? -1).toBe(1);
  });

  test("orphans render at the root instead of vanishing", () => {
    const folders: FolderMeta[] = [{ id: "x", parentId: "ghost", name: "X" }];
    const entries = orderTree(folders, []);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.depth).toBe(0);
  });
});
