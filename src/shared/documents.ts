/**
 * The document type, shared by the server (storage, API) and the
 * renderer (sidebar, editor).
 *
 * A document is a `.md` file in the user's Textpilot folder plus the
 * metadata the sidebar needs to list it without loading its text. Its
 * `id` is the file's place in the tree, so the title is the filename
 * itself; the filesystem is the source of truth.
 */
export interface DocumentMeta {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  /** The folder this document lives in; null = sidebar root. */
  readonly parentId?: string | null;
}

export interface DocumentRecord extends DocumentMeta {
  readonly text: string;
}

/** 2 MB of Markdown is far beyond any honest document. */
export const MAX_DOCUMENT_BYTES = 2_000_000;

/**
 * UTF-8 byte length of a document string.
 *
 * `String.length` counts UTF-16 code units, so an emoji-heavy document
 * can be several times larger on disk than `length` suggests. Every
 * size gate must use bytes, matching what `stat` reports. `TextEncoder`
 * keeps this isomorphic (renderer + server + tests).
 */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * The title a document's text suggests: its first non-empty line as
 * plain text, with markdown and inline HTML stripped. Empty or untitled
 * documents get a stable fallback so a name always exists.
 *
 * This is a *name*, not a display string. It is deliberately not
 * truncated here: a title becomes a filename, and a name cut short with
 * an ellipsis is a lie on disk - `sanitizeName` owns the filesystem's
 * length limit, and the sidebar lets CSS clip what it shows.
 */
export function deriveTitle(markdown: string): string {
  for (const rawLine of markdown.split("\n")) {
    let line = rawLine.trim();
    if (line.length === 0) continue;
    // Fenced code boundaries and horizontal rules carry no title text.
    if (/^```/.test(line)) continue;
    if (/^(---|\*\*\*|___)\s*$/.test(line)) continue;
    // Bare block markers with no content carry no title text.
    if (/^#{1,6}\s*$/.test(line)) continue;
    if (/^([-*+]\s*|\d+[.)]\s*|>+)\s*$/.test(line)) continue;
    // Link reference definitions are metadata, not a title.
    if (/^\[[^\]]+\]:\s*\S/.test(line)) continue;

    // Block prefixes: ATX headings (incl. closing hashes), quotes, lists.
    line = line.replace(/^#{1,6}\s+/, "").replace(/\s+#{1,6}\s*$/, "");
    line = line.replace(/^(>\s*)+/, "");
    line = line.replace(/^([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, "");
    if (line.length === 0) continue;

    // Autolinks keep their URL text; images/links keep their text.
    line = line.replace(/<(https?:\/\/[^>\s]+)>/g, "$1");
    line = line
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");
    // Inline HTML (underline, highlight, …) has no text of its own.
    line = line.replace(/<!--.*?-->/g, "").replace(/<\/?[A-Za-z][^>]*>/g, "");
    // Paired inline markers keep their content (single `_` needs word
    // boundaries so snake_case survives).
    line = line.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1");
    line = line.replace(/\*(.+?)\*/g, "$1");
    line = line.replace(/(^|\W)_([^_]+?)_($|\W)/g, "$1$2$3");
    line = line.replace(/~~(.+?)~~/g, "$1").replace(/==(.+?)==/g, "$1");
    line = line.replace(/`(.+?)`/g, "$1");
    line = line.replace(/\\([\\`*_{}[\]()#+\-.!<>])/g, "$1");
    line = line.replace(/\s+/g, " ").trim();
    if (line.length === 0) continue;

    return line;
  }
  return "Untitled";
}
