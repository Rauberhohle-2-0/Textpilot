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
import { jsonOnly, localOnly, sameOriginOnly } from "./middleware/local-only.ts";
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
}

/** Twice the document cap: room for JSON escaping, not for a huge body. */
const MAX_BODY_BYTES = MAX_DOCUMENT_BYTES * 2;

export function createApp({ logger, libraryRoot }: CreateAppOptions = {}): Hono {
  const app = new Hono();

  if (logger) {
    const accessLogger = logger.child("server");
    app.use(requestLogger(accessLogger));
  }

  // Hardening, in the order the checks must run: who is asking, whether a
  // browser vouches for them, then what they are allowed to send. The
  // body limit sits before any handler that parses, so an oversized body
  // is refused instead of buffered.
  app.use(localOnly());
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
        // Tailwind injects its styles at runtime.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
    }),
  );

  app.route("/", greetingRoutes);
  app.route("/api", apiRoutes);

  // One store for one filesystem: the documents routes and the folders
  // routes read and write the same tree, so they must be the same store.
  const library = createFilesystemLibrary({ root: libraryRoot ?? appConfig.data.root, logger });
  app.route("/api", createDocumentRoutes({ store: library.documents, logger }));
  app.route("/api", createFolderRoutes({ store: library.folders, logger }));

  return app;
}
