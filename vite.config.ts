import { defineConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";

/**
 * Dev-only CSP relaxation for the renderer's meta tag.
 *
 * Vite injects dev styles and the HMR client as inline `<style>` tags,
 * which the strict production policy refuses. Dev is served by Vite on
 * loopback only, so the relaxation never ships: the built renderer keeps
 * the strict meta CSP, and the packaged app is served by the Hono sidecar
 * whose own `secureHeaders` are equally strict. Matched on the comment
 * above the directive rather than the whole attribute, so an unrelated
 * CSP edit does not silently drop the relaxation.
 *
 * The `ctx.server` flag is Vite's own dev/production tell: it is defined
 * only while the dev server serves the HTML, so the built output is never
 * touched.
 */
function relaxDevCsp(): Plugin {
  return {
    name: "relax-dev-csp",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (!ctx.server) return html;
        return html.replace("style-src 'self';", "style-src 'self' 'unsafe-inline';");
      },
    },
  };
}

/** Builds the renderer into `dist/renderer` for production/packaging. */
export default defineConfig({
  root: "src/renderer",
  plugins: [tailwindcss(), relaxDevCsp()],
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
  },
});
