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
import type { Logger } from "../logging/logger.ts";
import { appConfig } from "../config/app.ts";
import { createNoteRoutes, createFileNoteStore } from "./features/notes/index.ts";
import {
  createDocumentRoutes,
  createFileDocumentStore,
} from "./features/documents/index.ts";
import { createFolderRoutes, createFileFolderStore } from "./features/folders/index.ts";
import { requestLogger } from "./middleware/request-logger.ts";
import { apiRoutes } from "./routes/api.ts";
import { greetingRoutes } from "./routes/greeting.ts";

export interface CreateAppOptions {
  /** Receives request logs. Child loggers are derived from it. */
  logger?: Logger;
}

export function createApp({ logger }: CreateAppOptions = {}): Hono {
  const app = new Hono();

  if (logger) {
    const accessLogger = logger.child("server");
    app.use(requestLogger(accessLogger));
  }

  app.route("/", greetingRoutes);
  app.route("/api", apiRoutes);
  app.route(
    "/api",
    createNoteRoutes({
      store: createFileNoteStore({ path: appConfig.data.note, logger }),
      logger,
    }),
  );
  app.route(
    "/api",
    createDocumentRoutes({
      store: createFileDocumentStore({ directory: appConfig.data.documents, logger }),
      logger,
    }),
  );
  app.route(
    "/api",
    createFolderRoutes({
      store: createFileFolderStore({ path: appConfig.data.folders, logger }),
      documentStore: createFileDocumentStore({ directory: appConfig.data.documents, logger }),
      documentsDirectory: appConfig.data.documents,
      logger,
    }),
  );

  return app;
}
