import { describe, expect, test } from "bun:test";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodeId,
  encodeId,
  LibraryPathError,
  normalizeRelative,
  resolveWithinLibrary,
  sanitizeName,
  uniqueName,
} from "../../src/shared/paths.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "textpilot-paths-"));
}

describe("encodeId / decodeId", () => {
  test("round-trips a nested path", () => {
    const id = encodeId("Projects/Notes/Plan.md");
    expect(decodeId(id)).toBe("Projects/Notes/Plan.md");
  });

  test("an id is base64url-shaped, one URL segment", () => {
    const id = encodeId("a/b c.md");
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("rejects ids that are not canonical base64url", () => {
    expect(decodeId("")).toBeNull();
    expect(decodeId("not base64!")).toBeNull();
    expect(decodeId("..%2F..%2Fetc")).toBeNull();
    expect(decodeId("a")).toBeNull(); // too short to be canonical
  });

  test("rejects a decoded path that escapes or hides", () => {
    expect(decodeId(encodeId("../secret.md"))).toBeNull();
    expect(decodeId(encodeId("/etc/passwd"))).toBeNull();
    expect(decodeId(encodeId(".textpilot/migrated.json"))).toBeNull();
  });
});

describe("normalizeRelative", () => {
  test("accepts plain nested paths", () => {
    expect(normalizeRelative("A/B.md")).toBe("A/B.md");
  });

  test("rejects absolute, climbing and empty paths", () => {
    expect(normalizeRelative("/etc/passwd")).toBeNull();
    expect(normalizeRelative("C:\\Users")).toBeNull();
    expect(normalizeRelative("A/../../B")).toBeNull();
    expect(normalizeRelative("")).toBeNull();
    expect(normalizeRelative("A//B")).toBeNull();
  });
});

describe("sanitizeName", () => {
  test("strips characters no filesystem accepts", () => {
    expect(sanitizeName("a/b:c*d?e")).toBe("abcde");
  });

  test("trims leading dots and spaces (Windows dislikes both)", () => {
    expect(sanitizeName("  .env  ")).toBe("env");
  });

  test("falls back when nothing survives", () => {
    expect(sanitizeName("///")).toBe("Untitled");
    expect(sanitizeName("///", "New Folder")).toBe("New Folder");
  });

  test("keeps a reserved device name from being one", () => {
    expect(sanitizeName("CON")).toBe("CON_");
  });

  test("caps the length", () => {
    expect(sanitizeName("x".repeat(200)).length).toBeLessThanOrEqual(100);
  });

  test("cuts an over-long name between words, never mid-word", () => {
    const name = sanitizeName("Lorem ipsum dolor sit amet, consetetur sadipscing elitr sed diam");
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name).toBe("Lorem ipsum dolor sit amet, consetetur sadipscing elitr sed diam");

    const longer = sanitizeName(
      "Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore",
    );
    expect(longer.length).toBeLessThanOrEqual(100);
    expect(longer.endsWith(" ")).toBe(false);
    // The cut lands on a word boundary (after "ut"), not inside "labore".
    expect(longer.endsWith("invidunt ut")).toBe(true);
  });
});

describe("uniqueName", () => {
  test("counts up past existing names", () => {
    const root = tempRoot();
    expect(uniqueName(root, "Notes", ".md")).toBe("Notes.md");
    writeFileSync(join(root, "Notes.md"), "");
    expect(uniqueName(root, "Notes", ".md")).toBe("Notes 2.md");
  });

  test("a rename ignores the file it is about to move", () => {
    const root = tempRoot();
    writeFileSync(join(root, "Notes.md"), "");
    expect(uniqueName(root, "Notes", ".md", "Notes.md")).toBe("Notes.md");
  });
});

describe("resolveWithinLibrary", () => {
  test("resolves a valid path under the root", () => {
    const root = tempRoot();
    expect(resolveWithinLibrary(root, "A/B.md")).toBe(join(root, "A", "B.md"));
  });

  test("refuses a path that climbs out", () => {
    const root = tempRoot();
    expect(() => resolveWithinLibrary(root, "../outside.md")).toThrow(LibraryPathError);
    expect(() => resolveWithinLibrary(root, "A/../../outside.md")).toThrow(LibraryPathError);
    expect(() => resolveWithinLibrary(root, "/etc/passwd")).toThrow(LibraryPathError);
  });

  test("refuses a path reached through a symlink out of the library", () => {
    const root = tempRoot();
    const outside = tempRoot();
    symlinkSync(outside, join(root, "escape"));
    expect(() => resolveWithinLibrary(root, "escape/notes.md")).toThrow(LibraryPathError);
  });
});
