/**
 * The renderer's client for the backend API: every endpoint the UI can
 * reach, in one place the views never have to know the shape of.
 *
 * The directory name is load-bearing. `src/renderer` is the dev server's
 * document root, so a directory here becomes a URL prefix for the
 * modules inside it - and the dev server forwards `/api` to the backend,
 * as a prefix match. A directory called `api` (or anything starting with
 * it) would have its own modules handed to the API server and answered
 * with a 404: a renderer that breaks in dev only, which no unit test and
 * no production build would notice, because bundling resolves files
 * rather than URLs. `tests/renderer/module-urls.test.ts` holds that line.
 */
export * from "./documents.ts";
export * from "./folders.ts";
