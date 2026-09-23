/**
 * Sanitization of document HTML.
 *
 * The renderer renders Markdown into HTML before showing it, and that
 * HTML may carry inline tags from the document (or a compromised
 * client's save). Nothing reaches the DOM unsanitized: this module is
 * the single allowlist both sides agree on. The server no longer needs
 * it - storage keeps Markdown as text - but the client runs every
 * rendered document through it.
 */
import sanitizeHtml from "sanitize-html";

/**
 * What a writer may format. Structural tags come with their usual
 * attributes; styles are not carried through, so formatting stays
 * semantic instead of decaying into inline style soup.
 */
export const ALLOWED_TAGS = [
  "p", "br", "hr",
  "h1", "h2", "h3",
  "b", "strong", "i", "em", "u", "s", "del", "mark",
  "blockquote", "pre", "code",
  "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "th", "td",
  "a",
] as const;

export const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ["href", "title"],
  // markdown-it emits `align` on table cells for `:---:` column
  // alignment. It is an enumerated attribute, so it carries no script
  // or style surface.
  th: ["align"],
  td: ["align"],
};

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [...ALLOWED_TAGS],
  allowedAttributes: ALLOWED_ATTRIBUTES,
  // URLs are restricted to safe schemes; javascript: and data: are dropped.
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { a: ["http", "https", "mailto"] },
  // Relative links are fine; a note is a self-contained document.
  allowProtocolRelative: false,
};

export function sanitizeDocumentHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}
