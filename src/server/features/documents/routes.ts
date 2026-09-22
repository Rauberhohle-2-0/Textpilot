/**
 * The `/api/documents` routes: list, create, load, save, rename and move.
 *
 * Documents are Markdown files in the user's library, stored verbatim;
 * the client renders sanitized HTML before showing anything. The
 * filename is the title, so a rename is a file rename and the response
 * carries the document's new id.
 *
 * Every guard here is about refusing a request, not repairing one: an id
 * that is not id-shaped never reaches the store's path lookup, and a
 * body that is not the expected shape gets a 400 naming the shape.
 */
import { Hono, type Context } from "hono";
import type { Logger } from "../../../logging/logger.ts";
import { MAX_DOCUMENT_BYTES, utf8ByteLength } from "../../../shared/documents.ts";
import { INVALID_ID, isValidId, parentIdOf } from "../../../shared/ids.ts";
import {
  DocumentNotFoundError,
  DocumentTooLargeError,
  FolderPlacementError,
  type DocumentStore,
} from "../library/store.ts";

export interface DocumentRoutesOptions {
  store: DocumentStore;
  logger?: Logger;
}

export function createDocumentRoutes({ store, logger }: DocumentRoutesOptions): Hono {
  const log = logger?.child("documents");
  const routes = new Hono();

  routes.get("/documents", async (c) => {
    const documents = await store.list();
    log?.debug("documents listed", { count: documents.length });
    return c.json({ documents }, 200);
  });

  routes.post("/documents", async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { text?: unknown; parentId?: unknown }
      | null;
    const text = body?.text ?? "";
    if (typeof text !== "string") {
      return c.json({ error: "expected { text?: string, parentId?: string | null }" }, 400);
    }
    if (utf8ByteLength(text) > MAX_DOCUMENT_BYTES) {
      return c.json({ error: "document too large" }, 413);
    }
    const parent = parentIdOf(body?.parentId);
    if (parent === INVALID_ID) {
      return c.json({ error: "parentId must be a string or null" }, 400);
    }
    try {
      const document = await store.create(text, parent);
      log?.info("document created", { id: document.id });
      return c.json(document, 201);
    } catch (error) {
      return documentFailure(c, error);
    }
  });

  routes.patch("/documents/:id", async (c) => {
    const id = c.req.param("id");
    if (!isValidId(id)) return c.json({ error: "invalid document id" }, 400);
    const body = (await c.req.json().catch(() => null)) as
      | { parentId?: unknown; title?: unknown }
      | null;
    if (!body) return c.json({ error: "expected body" }, 400);

    // Rename and move are exclusive operations: accepting both would let
    // one silently win, and accepting neither turned `{}` into a move to
    // the library root. Both cases are refused so the caller's intent is
    // always explicit.
    const wantsRename = typeof body.title === "string";
    const wantsMove = body.parentId !== undefined;
    if (wantsRename && wantsMove) {
      return c.json({ error: "specify either title or parentId, not both" }, 400);
    }
    if (!wantsRename && !wantsMove) {
      return c.json({ error: "expected { title: string } or { parentId: string | null }" }, 400);
    }

    if (wantsRename) {
      try {
        const document = await store.rename(id, (body.title as string).trim().slice(0, 200));
        log?.info("document renamed", { id, to: document.id });
        return c.json(document, 200);
      } catch (error) {
        return documentFailure(c, error);
      }
    }

    const parent = parentIdOf(body.parentId);
    if (parent === INVALID_ID) {
      return c.json({ error: "parentId must be a string or null" }, 400);
    }
    try {
      const document = await store.move(id, parent);
      log?.info("document moved", { id, parentId: parent });
      return c.json(document, 200);
    } catch (error) {
      return documentFailure(c, error);
    }
  });

  routes.get("/documents/:id", async (c) => {
    const id = c.req.param("id");
    if (!isValidId(id)) return c.json({ error: "invalid document id" }, 400);
    try {
      const document = await store.load(id);
      log?.debug("document loaded", { id, bytes: utf8ByteLength(document.text) });
      return c.json(document, 200);
    } catch (error) {
      return documentFailure(c, error);
    }
  });

  routes.put("/documents/:id", async (c) => {
    const id = c.req.param("id");
    if (!isValidId(id)) return c.json({ error: "invalid document id" }, 400);
    const body = (await c.req.json().catch(() => null)) as { text?: unknown } | null;
    if (!body || typeof body.text !== "string") {
      return c.json({ error: "expected { text: string }" }, 400);
    }
    if (utf8ByteLength(body.text) > MAX_DOCUMENT_BYTES) {
      return c.json({ error: "document too large" }, 413);
    }
    try {
      const document = await store.save(id, body.text);
      log?.info("document saved", { id, bytes: utf8ByteLength(body.text) });
      return c.json(document, 200);
    } catch (error) {
      return documentFailure(c, error);
    }
  });

  routes.delete("/documents/:id", async (c) => {
    const id = c.req.param("id");
    if (!isValidId(id)) return c.json({ error: "invalid document id" }, 400);
    const removed = await store.delete(id);
    if (!removed) return c.json({ error: "document not found" }, 404);
    return c.body(null, 204);
  });

  return routes;
}

/**
 * A failed document write or read: 404 when the document is gone, 413
 * when it is too large, 400 when the folder it names is not one, and a
 * rethrow - a 500 - for anything else, so a broken filesystem is never
 * reported as a bad request.
 */
function documentFailure(c: Context, error: unknown): Response {
  if (error instanceof DocumentNotFoundError) {
    return c.json({ error: "document not found" }, 404);
  }
  if (error instanceof DocumentTooLargeError) {
    return c.json({ error: "document too large" }, 413);
  }
  if (error instanceof FolderPlacementError) {
    return c.json({ error: error.message }, 400);
  }
  throw error;
}
