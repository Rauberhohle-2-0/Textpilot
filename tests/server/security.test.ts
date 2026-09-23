import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/server/app.ts";
import { MAX_DOCUMENT_BYTES } from "../../src/shared/documents.ts";
import { apiToken, resetApiTokenThrottle } from "../../src/server/middleware/local-only.ts";
import { Hono } from "hono";

const JSON_HEADERS = { "content-type": "application/json" };

/** A throwaway library root: these tests never touch a real Documents folder. */
const libraryRoot = mkdtempSync(join(tmpdir(), "textpilot-security-"));

describe("request guards", () => {
  test("a request addressed to a foreign host is refused", async () => {
    // What a page reaches the loopback API with after a DNS rebinding:
    // its own hostname, resolved to 127.0.0.1. `Host` gives it away.
    const app = createApp({ libraryRoot });
    const res = await app.request("/api/documents", {
      method: "POST",
      headers: { ...JSON_HEADERS, host: "rebound.example" },
      body: JSON.stringify({ text: "smuggled" }),
    });
    expect(res.status).toBe(403);
  });

  test("a browser declaring itself cross-site is refused", async () => {
    // The content types a browser sends without a preflight are the ones
    // CSRF middleware watches, and Sec-Fetch-Site is the browser saying
    // which side it is on. Both together are an attack, not a client.
    const app = createApp({ libraryRoot });
    const res = await app.request("/api/documents", {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        origin: "http://rebound.example",
        "sec-fetch-site": "cross-site",
      },
      body: "text=smuggled",
    });
    expect(res.status).toBe(403);
  });

  test("a write that declares no origin is judged by its content type", async () => {
    // curl, the packaging runtime and the tests all look like this: no
    // Origin, no Sec-Fetch-Site. They must not be refused for silence.
    const app = createApp({ libraryRoot });
    const res = await app.request("/api/documents", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "text=smuggled",
    });
    expect(res.status).toBe(415);
  });

  test("a bodyless DELETE still reaches the route", async () => {
    // Deletes carry no body and therefore no content type; they must not
    // be mistaken for a form post on their way to the handler.
    const app = createApp({ libraryRoot });
    const res = await app.request("/api/documents/does-not-exist", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  test("a write that is not JSON is refused", async () => {
    const app = createApp({ libraryRoot });
    const res = await app.request("/api/documents", {
      method: "POST",
      headers: { "content-type": "application/xml" },
      body: "<document/>",
    });
    expect(res.status).toBe(415);
  });

  test("an oversized body is refused before anything parses it", async () => {
    const app = createApp({ libraryRoot });
    const res = await app.request("/api/documents", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ text: "x".repeat(MAX_DOCUMENT_BYTES * 2 + 5_000) }),
    });
    expect(res.status).toBe(413);
  });

  test("reads are untouched by the write guards", async () => {
    const app = createApp({ libraryRoot });
    expect((await app.request("/api/health")).status).toBe(200);
    expect((await app.request("/api/documents")).status).toBe(200);
  });

  test("a host header with a malformed port is foreign, not loopback", async () => {
    // URL-based parsing validates the port too: a header like this must
    // not pass because its hostname part happens to read as loopback.
    const app = createApp({ libraryRoot });
    const res = await app.request("/api/documents", {
      headers: { host: "127.0.0.1:not-a-port" },
    });
    expect(res.status).toBe(403);
  });

  test("an IPv6 loopback host is accepted", async () => {
    const app = createApp({ libraryRoot });
    const res = await app.request("/api/health", {
      headers: { host: "[::1]:4000" },
    });
    expect(res.status).toBe(200);
  });
});

describe("bearer token throttle", () => {
  const APP = new Hono();
  APP.use("/api/*", apiToken());
  APP.get("/api/health", (c) => c.json({ ok: true }));

  const attempt = (token: string) =>
    APP.request("/api/health", { headers: { authorization: `Bearer ${token}` } });

  beforeEach(() => resetApiTokenThrottle());

  test("repeated failures lock the endpoint even for a correct token", async () => {
    process.env.TEXTPILOT_TOKEN = "secret";
    try {
      for (let i = 0; i < 10; i += 1) {
        expect((await attempt("wrong")).status).toBe(401);
      }
      // Locked: even the right token is refused now.
      expect((await attempt("secret")).status).toBe(429);
      // And an unauthenticated request too - the lockout is not a bypass.
      expect((await APP.request("/api/health")).status).toBe(429);
    } finally {
      delete process.env.TEXTPILOT_TOKEN;
    }
  });

  test("a success clears the failure count", async () => {
    process.env.TEXTPILOT_TOKEN = "secret";
    try {
      for (let i = 0; i < 9; i += 1) {
        expect((await attempt("wrong")).status).toBe(401);
      }
      expect((await attempt("secret")).status).toBe(200);
      // The counter reset: nine more failures do not lock.
      for (let i = 0; i < 9; i += 1) {
        expect((await attempt("wrong")).status).toBe(401);
      }
      expect((await attempt("secret")).status).toBe(200);
    } finally {
      delete process.env.TEXTPILOT_TOKEN;
    }
  });

  test("no token configured means no throttle and no auth", async () => {
    delete process.env.TEXTPILOT_TOKEN;
    expect((await APP.request("/api/health")).status).toBe(200);
  });
});
