/**
 * The `/api/folders` routes: create, rename, move and delete folders.
 *
 * A folder is a real directory, so deleting one removes its subtree from
 * disk in the same request - the filesystem is the cascade. There is no
 * ordering to store (siblings sort by name), so a move is placement
 * only.
 */
import { Hono, type Context } from "hono";
import type { Logger } from "../../../logging/logger.ts";
import { INVALID_ID, isValidId, parentIdOf } from "../../../shared/ids.ts";
import { FolderNotFoundError, FolderPlacementError, type FolderStore } from "../library/store.ts";

export interface FolderRoutesOptions {
  store: FolderStore;
  logger?: Logger;
}

export function createFolderRoutes({ store, logger }: FolderRoutesOptions): Hono {
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
    const parentId = parentIdOf(body.parentId);
    if (parentId === INVALID_ID) {
      return c.json({ error: "parentId must be a string or null" }, 400);
    }
    try {
      const folder = await store.create(body.name.trim().slice(0, 120), parentId);
      return c.json(folder, 201);
    } catch (error) {
      return folderFailure(c, error);
    }
  });

  routes.patch("/folders/:id", async (c) => {
    const id = c.req.param("id");
    if (!isValidId(id)) return c.json({ error: "invalid folder id" }, 400);
    const body = (await c.req.json().catch(() => null)) as
      | { name?: unknown; parentId?: unknown }
      | null;
    if (!body) return c.json({ error: "expected body" }, 400);

    // Rename and move are exclusive, as with documents: both at once is
    // ambiguous, neither is a no-op. Non-string `name` alongside a move
    // is ignored (it names nothing), but an explicit pair is refused.
    const wantsRename = typeof body.name === "string";
    const wantsMove = body.parentId !== undefined;
    if (wantsRename && wantsMove) {
      return c.json({ error: "specify either name or parentId, not both" }, 400);
    }
    if (!wantsRename && !wantsMove) {
      return c.json({ error: "nothing to update" }, 400);
    }

    const renameTo = wantsRename ? (body.name as string).trim().slice(0, 120) : null;
    const parentId = parentIdOf(body.parentId);
    if (parentId === INVALID_ID) {
      return c.json({ error: "parentId must be a string or null" }, 400);
    }

    try {
      if (renameTo !== null) {
        return c.json(await store.rename(id, renameTo), 200);
      }
      return c.json(await store.move(id, parentId), 200);
    } catch (error) {
      return folderFailure(c, error);
    }
  });

  routes.delete("/folders/:id", async (c) => {
    const id = c.req.param("id");
    if (!isValidId(id)) return c.json({ error: "invalid folder id" }, 400);
    const removed = await store.delete(id);
    if (!removed) return c.json({ error: "folder not found" }, 404);
    log?.info("folder deleted", { id });
    return c.body(null, 204);
  });

  return routes;
}

/**
 * A failed folder write: 404 when the folder is gone, 400 when the
 * placement was impossible, and a rethrow - a 500 - for anything else,
 * so a broken filesystem is never reported as a bad request.
 */
function folderFailure(c: Context, error: unknown): Response {
  if (error instanceof FolderNotFoundError) {
    return c.json({ error: error.message }, 404);
  }
  if (error instanceof FolderPlacementError) {
    return c.json({ error: error.message }, 400);
  }
  throw error;
}
