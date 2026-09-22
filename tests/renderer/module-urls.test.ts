import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { API_PREFIX } from "../../src/config/app.ts";

/**
 * The renderer root is also the dev server's document root, so every
 * top-level directory in it becomes a URL prefix for the modules inside.
 *
 * The backend prefix is claimed: the dev server forwards it (as a prefix
 * match) to the API. A renderer directory whose name starts with it
 * would have its own modules handed to the API server and answered with
 * a 404 - a renderer that breaks in dev only, which no unit test and no
 * production build notices, because bundling resolves files rather than
 * URLs. This rule exists because `src/renderer/api/` was shipped once.
 */
describe("renderer module URLs", () => {
  test("no renderer directory shadows the prefix the backend owns", () => {
    const rendererRoot = fileURLToPath(new URL("../../src/renderer", import.meta.url));
    const directories = readdirSync(rendererRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const reserved = API_PREFIX.replace(/^\//, "");
    expect(directories.filter((name) => name.startsWith(reserved))).toEqual([]);
  });
});
