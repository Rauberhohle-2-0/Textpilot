/**
 * The id shape documents and folders share, and the readers the routes
 * use to accept one from a client.
 *
 * An id is a library path in base64url (see `paths.ts`), so the shape is
 * just the base64url alphabet. A client's id is opaque - it can never
 * name a path itself - and the store decodes it and confines the result
 * to the library, so validating the shape here before a lookup is the
 * cheap first of those two gates. The length cap matters for the same
 * reason it always did: an unbounded string from a client should never
 * reach a filesystem call.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Longest id accepted; a deep library path still fits well inside it. */
const MAX_ID_LENGTH = 2048;

export function isValidId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_ID_LENGTH && ID_PATTERN.test(value);
}

/** Marks a `parentId` that is neither a valid id nor null. */
export const INVALID_ID = Symbol("invalid id");

/**
 * A client's `parentId` as a store wants it: a valid id, null for the
 * root, or `INVALID_ID` when it is neither - so a malformed reference is
 * refused rather than persisted.
 */
export function parentIdOf(value: unknown): string | null | typeof INVALID_ID {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return INVALID_ID;
  return isValidId(value) ? value : INVALID_ID;
}
