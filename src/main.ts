/**
 * Standalone entry: serve the app over HTTP without a window.
 * The desktop path lives in `dev.ts`.
 */
import { join } from "node:path";
import { serveStatic } from "hono/bun";
import { bootstrap } from "./bootstrap.ts";
import { appConfig, projectRoot } from "./config/app.ts";

const { app, logger } = await bootstrap();
const accessLogger = logger.child("main");

// The built renderer (vite build -> dist/renderer), resolved against the
// project root like every other path here: a run started from another
// directory must still find its own files.
//
// Scoped on purpose: the API is JSON-only and must never fall through
// to a file. Only GET/HEAD outside /api reach the static handler, and
// dotfiles (source maps aside, anything under /. ) never do - they fall
// through to the greeting page / 404 instead of leaking.
const serveRenderer = serveStatic({ root: join(projectRoot, "dist", "renderer") });
app.use(async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();
  const path = c.req.path;
  if (path === "/api" || path.startsWith("/api/")) return next();
  if (path.includes("/.")) return next();
  return serveRenderer(c, next);
});

const server = Bun.serve({
  port: appConfig.server.port,
  hostname: appConfig.server.host,
  fetch: app.fetch,
});

accessLogger.info(`listening on http://${appConfig.server.host}:${server.port}/`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    accessLogger.info(`received ${signal}, shutting down`);
    void server.stop(true);
    logger.close();
  });
}
