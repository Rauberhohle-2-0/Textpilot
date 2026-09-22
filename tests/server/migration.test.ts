import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFilesystemLibrary } from "../../src/server/features/library/index.ts";
import { migrateIntoTextpilot } from "../../src/server/features/migration/migrate-into-textpilot.ts";
import { Logger } from "../../src/logging/logger.ts";
import type { Transport } from "../../src/logging/transport.ts";

const silent: Transport = { name: "silent", write: () => {} };
const logger = new Logger({ level: "error", transports: [silent] });

/** Throwaway paths - the migration never sees real user data. */
function tempPaths() {
  const base = mkdtempSync(join(tmpdir(), "textpilot-migrate-"));
  return {
    root: join(base, "Textpilot"),
    legacyNote: join(base, "note.json"),
    legacyDocuments: join(base, "documents"),
    legacyFolders: join(base, "folders.json"),
  };
}

function writeLegacyNote(path: string, text: string): void {
  writeFileSync(path, JSON.stringify({ text, updatedAt: new Date(0).toISOString() }));
}

function writeLegacyDocument(directory: string, name: string, document: unknown): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${name}.json`), JSON.stringify(document));
}

describe("library migration", () => {
  test("the legacy note becomes a .md file and the old file is left alone", async () => {
    const paths = tempPaths();
    writeLegacyNote(paths.legacyNote, "# Chapter One\n\nFrom the single-note era.");

    expect(await migrateIntoTextpilot({ ...paths, logger })).toBe(true);
    expect(existsSync(paths.legacyNote)).toBe(true); // old data kept

    const documents = await createFilesystemLibrary({
      root: paths.root,
      logger,
    }).documents.list();
    expect(documents).toHaveLength(1);
    expect(documents[0]!.title).toBe("Chapter One");
    expect(readdirSync(paths.root)).toContain("Chapter One.md");
  });

  test("legacy folders become directories and documents file into them", async () => {
    const paths = tempPaths();
    writeFileSync(
      paths.legacyFolders,
      JSON.stringify({
        folders: [{ id: "folder-1", parentId: null, name: "Projects", position: 0 }],
      }),
    );
    writeLegacyDocument(paths.legacyDocuments, "doc-1", {
      text: "# Plan\n",
      parentId: "folder-1",
    });
    writeLegacyDocument(paths.legacyDocuments, "doc-2", { text: "# Loose\n" });

    expect(await migrateIntoTextpilot({ ...paths, logger })).toBe(true);

    const library = createFilesystemLibrary({ root: paths.root, logger });
    const folders = await library.folders.list();
    expect(folders.map((folder) => folder.name)).toEqual(["Projects"]);
    expect(existsSync(join(paths.root, "Projects", "Plan.md"))).toBe(true);
    expect(existsSync(join(paths.root, "Loose.md"))).toBe(true);

    const documents = await library.documents.list();
    const plan = documents.find((document) => document.title === "Plan");
    expect(plan?.parentId).toBe(folders[0]!.id);
  });

  test("a second run does not import again", async () => {
    const paths = tempPaths();
    writeLegacyNote(paths.legacyNote, "only once");

    await migrateIntoTextpilot({ ...paths, logger });
    const names = readdirSync(paths.root).filter((name) => name.endsWith(".md"));
    expect(names).toHaveLength(1);

    expect(await migrateIntoTextpilot({ ...paths, logger })).toBe(false);
    expect(readdirSync(paths.root).filter((name) => name.endsWith(".md"))).toHaveLength(1);
  });

  test("an existing library stops the migration, keeping the legacy file", async () => {
    const paths = tempPaths();
    mkdirSync(paths.root, { recursive: true });
    writeFileSync(join(paths.root, "Live.md"), "# Live");
    writeLegacyNote(paths.legacyNote, "# Stale");

    expect(await migrateIntoTextpilot({ ...paths, logger })).toBe(false);
    expect(existsSync(paths.legacyNote)).toBe(true);
    expect(readdirSync(paths.root).filter((name) => name.endsWith(".md"))).toEqual(["Live.md"]);
  });

  test("a missing, empty or corrupt note is left alone", async () => {
    const missing = tempPaths();
    expect(await migrateIntoTextpilot({ ...missing, logger })).toBe(false);

    const empty = tempPaths();
    writeLegacyNote(empty.legacyNote, "   ");
    expect(await migrateIntoTextpilot({ ...empty, logger })).toBe(false);

    const corrupt = tempPaths();
    writeFileSync(corrupt.legacyNote, '{"text": "trunc');
    expect(await migrateIntoTextpilot({ ...corrupt, logger })).toBe(false);
  });
});
