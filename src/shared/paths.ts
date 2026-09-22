/**
 * Library paths: the bridge between a document or folder's place on disk
 * and the opaque id the client passes around.
 *
 * The library is the user's real folder tree - `<Documents>/Textpilot` -
 * so a location is a root-relative path. An id is that path in base64url:
 * URL-safe, a single segment (Hono's `:id` matches one), and opaque, so a
 * client can never hand-build a filesystem path and a rename simply
 * yields a new id.
 *
 * Every id that becomes a path goes through here, so the checks that keep
 * a request inside the library - no absolute paths, no `..`, no hidden
 * segments, no symlink escapes - exist once and are impossible to forget.
 *
 * Server-only by design: it uses Node's `path`/`fs`/`Buffer`, and the
 * renderer only ever sees ids, never the paths behind them.
 */
import { existsSync, lstatSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Buffer } from "node:buffer";

/** Raised when a relative path names something outside the library. */
export class LibraryPathError extends Error {
  constructor(relativePath: string) {
    super(`path escapes the library: ${relativePath}`);
    this.name = "LibraryPathError";
  }
}

/** The base64url alphabet - the only shape a valid id can take. */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** A generous cap: deep trees, still far short of an unbounded string. */
const MAX_ID_LENGTH = 2048;

/** Filename characters no supported platform accepts, plus control codes. */
const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001F\u007F]/g;

/** Names Windows refuses outright, whatever the extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** Longest filename stem kept; every generated name stays well under it. */
const MAX_NAME_LENGTH = 100;

/**
 * When a name has to be cut, prefer the last word boundary at least this
 * far in - a name clipped mid-word reads like a bug, one clipped between
 * words reads like a name.
 */
const MIN_TRUNCATION_LENGTH = 40;

/** The id for a root-relative path (`Folder/Notes.md`). */
export function encodeId(relativePath: string): string {
  return Buffer.from(relativePath, "utf8").toString("base64url");
}

/**
 * The root-relative path an id names, or null when it is not a usable
 * library path. Null is "unknown", not "malformed": callers answer 404,
 * because an id that decodes to nothing simply names no document.
 */
export function decodeId(id: string): string | null {
  if (id.length === 0 || id.length > MAX_ID_LENGTH || !ID_PATTERN.test(id)) return null;
  const decoded = Buffer.from(id, "base64url").toString("utf8");
  // Re-encoding proves the id was canonical - a stray character or a bad
  // length decodes to something that would never round-trip.
  if (Buffer.from(decoded, "utf8").toString("base64url") !== id) return null;
  if (decoded.includes("\uFFFD")) return null; // not valid UTF-8
  return normalizeRelative(decoded);
}

/**
 * A root-relative path in canonical POSIX form, or null when it is
 * absolute, climbs out with `..`, is empty, or names a hidden entry -
 * `.textpilot` and friends stay the app's business, not the client's.
 */
export function normalizeRelative(value: string): string | null {
  if (value.length === 0 || value.includes("\0") || value.includes("\\")) return null;
  if (value.startsWith("/")) return null;
  if (/^[A-Za-z]:/.test(value)) return null; // Windows drive letter
  const segments = value.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") return null;
    if (segment.startsWith(".")) return null;
  }
  return segments.join("/");
}

/**
 * A name safe to create on every supported platform: no path separators,
 * no reserved characters, no leading/trailing dots or spaces (Windows),
 * bounded in length, and never a reserved device name. `fallback` names
 * what survives nothing - "Untitled" for documents, a folder default.
 */
export function sanitizeName(name: string, fallback = "Untitled"): string {
  let cleaned = name
    .replace(ILLEGAL_NAME_CHARS, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+/, "")
    .replace(/[. ]+$/, "");
  if (cleaned.length > MAX_NAME_LENGTH) {
    const cut = cleaned.slice(0, MAX_NAME_LENGTH);
    const lastSpace = cut.lastIndexOf(" ");
    cleaned = (lastSpace >= MIN_TRUNCATION_LENGTH ? cut.slice(0, lastSpace) : cut).trimEnd();
  }
  if (cleaned.length === 0) return fallback;
  if (WINDOWS_RESERVED.test(cleaned)) return `${cleaned}_`;
  return cleaned;
}

/**
 * The first free name in `directory`, counting up (`Notes.md`,
 * `Notes 2.md`, ...). `exclude` is a name to ignore for the collision
 * check: a rename must not see the file it is about to move as taken.
 */
export function uniqueName(
  directory: string,
  base: string,
  extension = "",
  exclude?: string,
): string {
  const isTaken = (name: string): boolean => name !== exclude && existsSync(join(directory, name));
  let candidate = `${base}${extension}`;
  let counter = 2;
  while (isTaken(candidate)) {
    candidate = `${base} ${counter}${extension}`;
    counter += 1;
  }
  return candidate;
}

/**
 * The absolute path a root-relative path names, guaranteed to live
 * inside `root`. Refuses anything that escapes lexically and anything
 * that would be reached by following a symlink out of the library.
 */
export function resolveWithinLibrary(root: string, relativePath: string): string {
  const normalized = normalizeRelative(relativePath);
  if (normalized === null) throw new LibraryPathError(relativePath);
  const target = join(root, ...normalized.split("/"));
  if (target !== root && !target.startsWith(root + sep)) throw new LibraryPathError(relativePath);
  assertNoSymlink(root, normalized);
  return target;
}

/** Reject a path any segment of which is a symlink, existing or not. */
function assertNoSymlink(root: string, relativePath: string): void {
  let current = root;
  for (const segment of relativePath.split("/")) {
    current = join(current, segment);
    let isLink: boolean;
    try {
      isLink = lstatSync(current).isSymbolicLink();
    } catch {
      return; // Does not exist yet: nothing can be followed.
    }
    if (isLink) throw new LibraryPathError(relativePath);
  }
}

/** An absolute path under `root` as its POSIX root-relative path. */
export function relativeToRoot(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join("/");
}
