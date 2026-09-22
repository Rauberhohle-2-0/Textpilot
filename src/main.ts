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
app.use(serveStatic({ root: join(projectRoot, "dist", "renderer") }));

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
