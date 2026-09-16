/**
 * The document type, shared by the server (storage, API) and the
 * renderer (sidebar, editor).
 *
 * A document is Markdown - the format of record - plus the metadata the
 * sidebar needs to list it without loading its text.
 */
export interface DocumentMeta {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  /** The folder this document lives in; null = sidebar root. */
  readonly parentId?: string | null;
  /** Order within its level; float, midpoint-assigned on drag. */
  readonly position?: number;
}

export interface DocumentRecord extends DocumentMeta {
  readonly text: string;
}

/**
 * The display title of a document: its first non-empty line as plain
 * text, with markdown and inline HTML stripped for the sidebar. Empty
 * or untitled documents get a stable fallback so a row always has a
 * name.
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

    const title = line.length > 0 ? line : "Untitled";
    return title.length > 60 ? `${title.slice(0, 57).trimEnd()}…` : title;
  }
  return "Untitled";
}
