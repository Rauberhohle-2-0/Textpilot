/**
 * The server as its own program, for `bun build --compile`.
 *
 * This is the only entry point that is ever compiled. It answers the API
 * and the built renderer from beside the executable - `vantail package`
 * copies `dist/` in wholesale, binary and all - on a port it picks
 * itself, printing the URL on stdout because the boot page that starts it
 * has no other way to find out (see `src/boot.ts`).
 *
 * No greeting routes here: the window is handed the renderer for `/`,
 * and a greeting page would hide the app behind it.
 */
import { dirname, join } from "node:path";
import { serveStatic } from "hono/bun";
import { bootstrap } from "./bootstrap.ts";
import { appConfig } from "./config/app.ts";
import type { CreateAppOptions } from "./server/app.ts";

const { app, logger } = await bootstrap({ greeting: false } satisfies CreateAppOptions);
const accessLogger = logger.child("serve");

// The built renderer sits beside the executable (`dist/renderer`), because
// that is where the build puts it next to the binary. Resolved against
// the executable rather than the project root: a compiled binary has no
// project around it any more.
//
// Scoped on purpose, like `main.ts`: the API is JSON-only and must never
// fall through to a file. Only GET/HEAD outside /api reach the static
// handler, and dotfiles never do.
const execDir = dirname(process.execPath);
const rendererRoot = join(execDir, "renderer");
const rendererIndex = join(rendererRoot, "index.html");
const serveRenderer = serveStatic({ root: rendererRoot });
app.use(async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();
  const path = c.req.path;
  if (path === "/api" || path.startsWith("/api/")) return next();
  if (path.includes("/.")) return next();
  return serveRenderer(c, next);
});

// `serveStatic` answers files, not directories: `/` and `/index.html` get
// the renderer's entry point explicitly. Registered after the static
// middleware, so a file that exists still wins over this fallback.
for (const path of ["/", "/index.html"] as const) {
  app.get(path, async (c) => {
    const file = Bun.file(rendererIndex);
    if (!(await file.exists())) return c.text("not found", 404);
    return new Response(file, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  });
}

const server = Bun.serve({
  port: 0,
  hostname: appConfig.server.host,
  fetch: app.fetch,
});

// The line `src/boot.ts` is waiting for. Flushed by the newline.
console.log(`listening on http://${appConfig.server.host}:${server.port}/`);
accessLogger.info(`serving renderer from ${rendererRoot}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    accessLogger.info(`received ${signal}, shutting down`);
    void server.stop(true);
    logger.close();
  });
}
