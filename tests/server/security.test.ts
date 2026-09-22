import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/server/app.ts";
import { MAX_DOCUMENT_BYTES } from "../../src/shared/documents.ts";

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
});
