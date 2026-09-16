/**
 * The `/api/folders` routes: create, rename, move and delete folders.
 *
 * Deleting a folder deletes its subtree - child folders and the
 * documents inside them - in the same request, so the sidebar and the
 * files on disk can never disagree about what exists.
 */
import { Hono } from "hono";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "../../../logging/logger.ts";
import type { FolderStore } from "./store.ts";
import { subtreeIds } from "./store.ts";
import type { DocumentStore } from "../documents/store.ts";

export interface FolderRoutesOptions {
  store: FolderStore;
  /** Used to cascade the delete to the documents inside the subtree. */
  documentStore: DocumentStore;
  /** Where document files live; needed to remove them on cascade. */
  documentsDirectory: string;
  logger?: Logger;
}

export function createFolderRoutes({
  store,
  documentStore,
  documentsDirectory,
  logger,
}: FolderRoutesOptions): Hono {
  const log = logger?.child("folders");
  const routes = new Hono();

  routes.get("/folders", async (c) => {
    const folders = await store.list();
    return c.json({ folders }, 200);
  });

  routes.post("/folders", async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { name?: unknown; parentId?: unknown }
      | null;
    if (!body || typeof body.name !== "string" || body.name.trim().length === 0) {
      return c.json({ error: "expected { name: string, parentId?: string }" }, 400);
    }
    const parentId = body.parentId === null || body.parentId === undefined ? null : body.parentId;
    if (parentId !== null && typeof parentId !== "string") {
      return c.json({ error: "parentId must be a string or null" }, 400);
    }
    try {
      const folder = await store.create(body.name.trim().slice(0, 120), parentId);
      return c.json(folder, 201);
    } catch (error) {
      log?.warn("folder create failed", { error: String(error) });
      return c.json({ error: "could not create folder" }, 400);
    }
  });

  routes.patch("/folders/:id", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as
      | { name?: unknown; parentId?: unknown; position?: unknown }
      | null;
    if (!body) return c.json({ error: "expected body" }, 400);
    try {
      if (typeof body.name === "string") {
        return c.json(await store.rename(id, body.name.trim().slice(0, 120)), 200);
      }
      if (body.parentId !== undefined || body.position !== undefined) {
        const parentId =
          body.parentId === null || body.parentId === undefined ? null : (body.parentId as string);
        if (parentId !== null && typeof parentId !== "string") {
          return c.json({ error: "parentId must be a string or null" }, 400);
        }
        const position =
          typeof body.position === "number" && Number.isFinite(body.position)
            ? body.position
            : Date.now() % 1e9;
        return c.json(await store.move(id, parentId, position), 200);
      }
      return c.json({ error: "nothing to update" }, 400);
    } catch (error) {
      log?.warn("folder update failed", { id, error: String(error) });
      return c.json({ error: "could not update folder" }, 400);
    }
  });

  routes.delete("/folders/:id", async (c) => {
    const id = c.req.param("id");
    const folders = await store.list();
    if (!folders.some((folder) => folder.id === id)) {
      return c.json({ error: "folder not found" }, 404);
    }
    const doomed = subtreeIds(folders, id);

    // Documents inside the subtree: delete their records and files.
    const documents = await documentStore.list();
    const allDocs = (await Promise.all(
      doomed.map((folderId) => documentsInFolder(documentStore, folderId)),
    )).flat();
    void documents;
    for (const document of allDocs) {
      await documentStore.delete(document.id);
      try {
        rmSync(join(documentsDirectory, `${document.id}.json`));
      } catch {
        // Already gone; the record removal is what matters.
      }
    }

    await store.delete(id);
    log?.info("folder subtree deleted", { id, folders: doomed, documents: allDocs.length });
    return c.body(null, 204);
  });

  return routes;
}

/** Documents whose parentId is the given folder. */
async function documentsInFolder(
  documentStore: DocumentStore,
  folderId: string,
): Promise<{ id: string; parentId?: string | null }[]> {
  const all = await documentStore.list();
  return all.filter((document) => (document.parentId ?? null) === folderId);
}
