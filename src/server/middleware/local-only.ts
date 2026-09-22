/**
 * Who may talk to this server, and what they may send.
 *
 * The app is a local desktop app with no accounts: anything that can
 * reach its loopback port can read and write the user's documents. Three
 * request-level guards keep that surface to the app itself.
 *
 * - `localOnly` refuses any request whose `Host` is not a loopback name.
 *   Browsers send the hostname they were given, so a page that resolves
 *   its own domain to 127.0.0.1 (DNS rebinding) arrives with a foreign
 *   Host and is turned away. An `Origin`/`Host` comparison cannot do
 *   this job: under rebinding both headers carry the attacker's name and
 *   agree with each other.
 * - `jsonOnly` refuses mutating requests that are not JSON. A cross-site
 *   request that can be sent without a preflight is always form-encoded
 *   or plain text, so this closes the "simple request" door - and the
 *   API means JSON anyway.
 * - `sameOriginOnly` refuses a request that declares itself foreign.
 * - `apiToken` is opt-in defense in depth for the residual threat
 *   model: any *local process* can reach loopback and pass the browser
 *   guards (no Origin to check). When `TEXTPILOT_TOKEN` is set, `/api/*`
 *   additionally requires `Authorization: Bearer <token>`; the bundled
 *   renderer sends it from the `textpilot-api-token` meta tag when one
 *   is present. Unset (the default for tests and plain `dev` runs)
 *   means no token is required.
 *
 * The guards overlap on purpose, and none of them trusts a header it did
 * not need to: a request that declares nothing is a local client, not a
 * browser, and is judged by its content type instead.
 */
import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

/** Hostnames that mean "this machine". Ports are ignored. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** The hostname part of a `Host` header: `127.0.0.1:3000` → `127.0.0.1`. */
function hostnameOf(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^\s*(\[[^\]]*\]|[^:]*)/.exec(header);
  return (match?.[1] ?? "").toLowerCase();
}

export function localOnly(): MiddlewareHandler {
  return async (c, next) => {
    const hostname = hostnameOf(c.req.header("host"));
    // A missing Host can only come from a non-browser client, which
    // could reach loopback regardless; it is not the rebinding case.
    if (hostname === null || LOOPBACK_HOSTS.has(hostname)) {
      await next();
      return;
    }
    return c.json({ error: "requests must be addressed to loopback" }, 403);
  };
}

/** Methods that carry a body and therefore need a content type. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH"]);

/**
 * Refuse a request that says it came from somewhere else.
 *
 * `Sec-Fetch-Site` is the browser's own answer to "who started this"
 * and `Origin` is the older equivalent; a cross-site page carries at
 * least one of them on every write, and on reads as well. A client that
 * sends neither (curl, the packaging runtime, the tests) is not the
 * CSRF case and is left to the other guards - which is why this is
 * hand-written rather than `hono/csrf`, whose middleware refuses an
 * absent `Origin` before it ever consults a custom rule, taking
 * bodyless DELETEs down with it.
 *
 * Checked before `jsonOnly`, so a cross-site form post is refused as
 * cross-site rather than as a content-type mistake.
 */
export function sameOriginOnly(): MiddlewareHandler {
  return async (c, next) => {
    const site = c.req.header("sec-fetch-site");
    if (site !== undefined && site !== "same-origin" && site !== "none") {
      return c.json({ error: "cross-site requests are not accepted" }, 403);
    }
    const origin = c.req.header("origin");
    if (origin !== undefined && origin !== new URL(c.req.url).origin) {
      return c.json({ error: "cross-site requests are not accepted" }, 403);
    }
    await next();
  };
}

export function jsonOnly(): MiddlewareHandler {
  return async (c, next) => {
    if (MUTATING_METHODS.has(c.req.method)) {
      const contentType = c.req.header("content-type") ?? "";
      if (!/^application\/(?:[a-z0-9.+-]+\+)?json\b/i.test(contentType)) {
        return c.json({ error: "content-type must be application/json" }, 415);
      }
    }
    await next();
  };
}

/**
 * Opt-in bearer token for `/api/*`. Disabled when `TEXTPILOT_TOKEN` is
 * unset or empty, so tests and plain dev runs behave as before. When
 * set, the comparison is constant-time and the failure is a 401 without
 * a `WWW-Authenticate` challenge (no browser login prompt wanted).
 */
export function apiToken(): MiddlewareHandler {
  return async (c, next) => {
    const expected = process.env.TEXTPILOT_TOKEN?.trim();
    if (!expected) {
      await next();
      return;
    }
    const header = c.req.header("authorization") ?? "";
    const match = /^Bearer (.+)$/.exec(header);
    if (match && safeEqual(match[1]!, expected)) {
      await next();
      return;
    }
    return c.json({ error: "unauthorized" }, 401);
  };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
