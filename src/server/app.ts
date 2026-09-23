/**
 * The Hono application, assembled from feature modules.
 *
 * Free of transport concerns: no port, no process lifetime. Anything that
 * has a `fetch` can serve it. A logger is injected instead of imported, so
 * tests get a silent logger and the entry points decide where output goes.
 * Server-side features live under `features/` and mount here - one line
 * each.
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import type { Logger } from "../logging/logger.ts";
import { appConfig } from "../config/app.ts";
import { MAX_DOCUMENT_BYTES } from "../shared/documents.ts";
import { createDocumentRoutes } from "./features/documents/index.ts";
import { createFolderRoutes } from "./features/folders/index.ts";
import { createFilesystemLibrary } from "./features/library/index.ts";
import { apiToken, jsonOnly, localOnly, sameOriginOnly } from "./middleware/local-only.ts";
import { requestLogger } from "./middleware/request-logger.ts";
import { apiRoutes } from "./routes/api.ts";
import { greetingRoutes } from "./routes/greeting.ts";

export interface CreateAppOptions {
  /** Receives request logs. Child loggers are derived from it. */
  logger?: Logger;
  /**
   * Override the library root. Defaults to the user's Textpilot folder;
   * tests point this at a temp directory so they never touch real notes.
   */
  libraryRoot?: string;
  /**
   * Serve the greeting page at `/` and `/index.html`. Default `true`.
   *
   * The packaged sidecar sets this to `false`: there the window is handed
   * the built renderer for those paths instead, and a greeting page would
   * hide the app behind it.
   */
  greeting?: boolean;
}

/** Three times the document cap: room for JSON escaping of hostile
 * input (a document of all quotes doubles when serialized), not for a
 * huge body. The routes re-check the decoded UTF-8 bytes. */
const MAX_BODY_BYTES = MAX_DOCUMENT_BYTES * 3;

export function createApp({ logger, libraryRoot, greeting = true }: CreateAppOptions = {}): Hono {
  const app = new Hono();

  // Never leak filesystem paths, errno strings or stacks to a client:
  // unexpected failures (a broken disk, a bug) all become the same
  // generic 500, with the detail going to the log only.
  app.onError((error, c) => {
    logger?.error("unhandled request error", {
      method: c.req.method,
      path: c.req.path,
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({ error: "internal error" }, 500);
  });

  if (logger) {
    const accessLogger = logger.child("server");
    app.use(requestLogger(accessLogger));
  }

  // Hardening, in the order the checks must run: who is asking, whether a
  // browser vouches for them, then what they are allowed to send. The
  // body limit sits before any handler that parses, so an oversized body
  // is refused instead of buffered.
  app.use(localOnly());
  app.use("/api/*", apiToken());
  app.use("/api/*", sameOriginOnly());
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: "request body too large" }, 413),
    }),
  );
  app.use("/api/*", jsonOnly());
  app.use(
    secureHeaders({
      // Plain HTTP on loopback: transport security is meaningless here,
      // and browsers ignore HSTS for IP hosts anyway.
      strictTransportSecurity: false,
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Tailwind compiles to a real stylesheet at build time, so no
        // style-src exceptions are needed in production. (Dev is served
        // by Vite, whose own relaxations never pass through here.)
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
        frameSrc: ["'none'"],
      },
    }),
  );

  if (greeting) {
    app.route("/", greetingRoutes);
  }
  app.route("/api", apiRoutes);

  // One store for one filesystem: the documents routes and the folders
  // routes read and write the same tree, so they must be the same store.
  const library = createFilesystemLibrary({ root: libraryRoot ?? appConfig.data.root, logger });
  app.route("/api", createDocumentRoutes({ store: library.documents, logger }));
  app.route("/api", createFolderRoutes({ store: library.folders, logger }));

  return app;
}
