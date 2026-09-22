/**
 * `bun run dev` - start the API server and Vite, then open the Vantail
 * window pointing at Vite.
 *
 * Two servers, one window:
 *
 * - Hono (`bootstrap`) serves `/api/*` on an internal port.
 * - Vite serves the renderer with Tailwind on demand and HMR, and proxies
 *   `/api` to Hono - so the page talks to one origin, as it will in
 *   production.
 *
 * The window is the runtime binary, handed a config whose `dev.url` is the
 * Vite port - the same approach as Vantail's own examples.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildRuntimeConfig } from "@vantail/cli";
import { resolveRuntimeBinary } from "@vantail/runtime";
import { bootstrap } from "./bootstrap.ts";
import { API_PREFIX, projectRoot } from "./config/app.ts";
import config from "../vantail.config.ts";

const { app, logger } = await bootstrap();
const devLogger = logger.child("dev");

const runtime = resolveRuntimeBinary({ cwd: projectRoot });

// The API on an internal port; Vite proxies /api to it.
const api = Bun.serve({ port: 0, fetch: app.fetch });
const apiOrigin = `http://127.0.0.1:${api.port}`;

const { createServer } = await import("vite");
const vitePort = await freePort();
const vite = await createServer({
  configFile: join(projectRoot, "vite.config.ts"),
  root: join(projectRoot, "src", "renderer"),
  server: {
    port: vitePort,
    strictPort: true,
    host: "127.0.0.1",
    // No `changeOrigin`: the API checks that the Host it is addressed
    // to is loopback and that a browser's Origin agrees with it, and
    // rewriting Host to the internal API port would make every proxied
    // request look cross-origin. Both are 127.0.0.1, so leaving the
    // Host alone is also the honest thing to send.
    //
    // The key ends in a slash because this is a *prefix* match: a bare
    // "/api" also swallows renderer modules served from a directory
    // called `api-something`, handing them to the backend as 404s.
    proxy: {
      [`${API_PREFIX}/`]: { target: apiOrigin },
    },
  },
});
// Under Bun the http server Vite creates does not start listening by
// itself, so the run owns that call. `strictPort` means no surprise port.
const httpServer = vite.httpServer!;
if (!httpServer.listening) {
  await new Promise<void>((resolve, reject) => {
    httpServer.once("listening", resolve);
    httpServer.once("error", reject);
    httpServer.listen(vitePort, "127.0.0.1");
  });
}
const url = `http://127.0.0.1:${vitePort}/`;

// The same file `vantail dev` writes, built by the same function - so the
// window gets the title and background colour from `vantail.config.ts`
// exactly as it would through the CLI.
const configDir = join(projectRoot, ".vantail");
const configPath = join(configDir, "dev.json");
mkdirSync(configDir, { recursive: true });
writeFileSync(
  configPath,
  JSON.stringify(buildRuntimeConfig({ config, root: projectRoot, devUrl: url }), null, 2),
);

devLogger.info("window config written", { path: configPath });
devLogger.info(`vite listening on ${url} (api at ${apiOrigin})`);
devLogger.info(`runtime at ${runtime.path}`);

const child = spawn(runtime.path, ["--config", configPath], {
  stdio: "inherit",
});
devLogger.info("window launched", { pid: child.pid });

// The window closing ends the run, the way `vantail dev` does it.
child.on("exit", (code) => {
  devLogger.info(`window closed (exit ${code ?? 0}), shutting down`);
  void vite.close();
  void api.stop(true);
  logger.close();
  process.exit(code ?? 0);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    devLogger.info(`received ${signal}, shutting down`);
    child.kill();
    void vite.close();
    void api.stop(true);
    logger.close();
  });
}

/** Ask the OS for a free port by borrowing one from Bun. */
async function freePort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 501 }) });
  const port = probe.port;
  await probe.stop(true);
  if (port === undefined) throw new Error("could not find a free port");
  return port;
}
