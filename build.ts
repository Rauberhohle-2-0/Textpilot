/**
 * `bun run build` - everything a packaged window needs, into `dist/`.
 *
 * `vantail package --no-build` then bundles that directory wholesale, so
 * whatever is here ends up inside the application: the built renderer,
 * the boot page, and the server itself as a compiled binary.
 *
 * That last part is what makes this packageable at all. `bun build
 * --compile` writes a single executable with the Bun runtime inside it,
 * so the machine running the app needs nothing installed. The runtime
 * knows it as `$RESOURCE/server`, which is how `permissions.shell`
 * names a sidecar shipped in the bundle.
 *
 * Layout of `dist/`:
 *
 *   index.html     the boot page - what the window opens
 *   boot.js        the boot page's script (starts the sidecar)
 *   server         the compiled API + renderer server
 *   renderer/      the Vite build (`vite.config.ts` writes it here)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");

function run(what: string, command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\n${what} failed.`);
    process.exit(result.status ?? 1);
  }
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// The renderer first: the page the sidecar serves for `/`.
run("Vite build", "bunx", ["vite", "build"]);

// The boot page is what the window opens, so it has to be `index.html` -
// the name the runtime asks for when nothing says otherwise. Deliberately
// styleless beyond a colour: it should be on screen for a few hundred
// milliseconds, and looking like a splash screen would only make it feel
// longer. The background matches `window.backgroundColor` so the first
// paint blends into the window chrome.
writeFileSync(join(dist, "index.html"), bootPage());

// The boot page is bundled too, because it imports `@vantail/api`, which
// a webview cannot resolve by name.
run(
  "Bundling the boot page",
  "bunx",
  ["bun", "build", "src/boot.ts", "--outfile", join(dist, "boot.js"), "--target", "browser"],
);

// The server, with the Bun runtime inside it. No build flag makes this
// small - tens of megabytes, of which the application is a fraction.
run(
  "Compiling the server",
  "bunx",
  ["bun", "build", "src/serve.ts", "--compile", "--outfile", join(dist, "server")],
);

console.log(`\n  dist/  ready - now run:  vantail package --no-build\n`);

/**
 * The page a packaged window opens.
 *
 * Not the application: the application comes from the server, and the
 * server is not running yet. This starts it and then replaces itself -
 * see `src/boot.ts`.
 */
function bootPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Textpilot</title>
    <style>
      html, body { height: 100%; margin: 0; background: #1E1E1E; color: #9a9aa6; }
      body { display: grid; place-items: center; font: 13px/1.5 system-ui, sans-serif; }
    </style>
    <script type="module" src="/boot.js"></script>
  </head>
  <body><p id="status">Starting&hellip;</p></body>
</html>`;
}
