/**
 * Central application configuration.
 *
 * One place for the values every entry point and module needs. Paths are
 * resolved against the project root so the app behaves the same no matter
 * which directory it was started from.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The project root: the directory that holds `src/`. */
export const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export const appConfig = {
  name: "Textpilot",
  identifier: "dev.textpilot.app",
  version: "0.1.0",

  server: {
    host: "127.0.0.1",
    port: Number(process.env.PORT ?? 3000),
  },

  logging: {
    /** Minimum level that reaches the transports. */
    level: "info" as LogLevel,
    /** Overwritten at the start of every run. */
    file: join(projectRoot, "logs", "app.log"),
  },

  data: {
    /** The user's document; survives closing and reopening the app. */
    note: join(projectRoot, "data", "note.json"),
    /** One JSON file per document; the sidebar lists these. */
    documents: join(projectRoot, "data", "documents"),
    /** The single file holding all folders. */
    folders: join(projectRoot, "data", "folders.json"),
  },
};

export type LogLevel = "debug" | "info" | "warn" | "error";
