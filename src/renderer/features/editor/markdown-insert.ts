/**
 * Markdown insertion for source mode.
 *
 * The toolbar's format buttons keep working while the raw markdown is
 * on screen: instead of running `execCommand` against the hidden rich
 * surface, each action edits the textarea's text directly.
 *
 * Conventions:
 * - A text selection is wrapped in the markers (`**sel**`), and stays
 *   selected so the next keystroke replaces it.
 * - An empty selection inserts the marker pair with the caret centered
 *   between them - `**|**` - ready to type the emphasized text.
 * - Block actions (headings, quote, lists) prefix every line the
 *   selection touches, and toggle the prefix off when it is already
 *   there.
 */
import type { FormatAction, TableSize } from "./formatting.ts";
import { tableMarkdown } from "./formatting.ts";

/** Inline marker pair for an action, when it has one. */
function inlineMarkers(action: FormatAction): { open: string; close: string } | undefined {
  switch (action.id) {
    case "bold": return { open: "**", close: "**" };
    case "italic": return { open: "*", close: "*" };
    case "strikethrough": return { open: "~~", close: "~~" };
    case "code": return { open: "`", close: "`" };
    // Markdown has no underline; <u> survives the round-trip and
    // readers that do not know it simply show the text.
    case "underline": return { open: "<u>", close: "</u>" };
    default: return undefined;
  }
}

const LINE_PREFIXES = /^(#{1,3}\s+|>\s+|[-*]\s+|\d+\.\s+)/;

export function insertMarkdown(textarea: HTMLTextAreaElement, action: FormatAction, tableSize?: TableSize): void {
  if (action.id === "code" && hasMultilineSelection(textarea)) {
    wrapBlock(textarea, "```", "```");
    return;
  }

  // A table is a block skeleton, not a wrapper: it goes in at the caret
  // whichever way the selection sits, like the rich surface does.
  if (action.id === "table") {
    insertBlock(textarea, tableMarkdown(tableSize));
    return;
  }

  const markers = inlineMarkers(action);
  if (markers) {
    wrapInline(textarea, markers.open, markers.close);
    return;
  }

  switch (action.id) {
    case "h1": prefixLines(textarea, "# "); return;
    case "h2": prefixLines(textarea, "## "); return;
    case "h3": prefixLines(textarea, "### "); return;
    case "paragraph": stripLinePrefixes(textarea); return;
    case "blockquote": prefixLines(textarea, "> "); return;
    case "bullet": prefixLines(textarea, "- "); return;
    case "number": numberLines(textarea); return;
  }
}

function wrapInline(textarea: HTMLTextAreaElement, open: string, close: string): void {
  const { selectionStart, selectionEnd, value } = textarea;
  const selected = value.slice(selectionStart, selectionEnd);
  if (selected.length > 0) {
    textarea.setRangeText(`${open}${selected}${close}`, selectionStart, selectionEnd, "select");
    return;
  }
  // Empty selection: insert the pair and center the caret between the
  // markers, so typing lands inside the formatting.
  textarea.setRangeText(`${open}${close}`, selectionStart, selectionEnd);
  textarea.selectionStart = selectionStart + open.length;
  textarea.selectionEnd = selectionStart + open.length;
}

/**
 * Insert a block-level skeleton at the caret, on its own lines. A
 * leading newline is added unless the caret already starts a line, so
 * the block never glues itself to the tail of the previous line. The
 * caret lands at the start of the inserted text, ready to overwrite
 * the skeleton.
 */
function insertBlock(textarea: HTMLTextAreaElement, block: string): void {
  const { selectionStart, value } = textarea;
  const atLineStart = selectionStart === 0 || value[selectionStart - 1] === "\n";
  const prefix = atLineStart ? "" : "\n";
  textarea.setRangeText(`${prefix}${block}`, selectionStart, textarea.selectionEnd, "end");
  textarea.selectionStart = selectionStart + prefix.length;
}

function wrapBlock(textarea: HTMLTextAreaElement, open: string, close: string): void {
  const { selectionStart, selectionEnd, value } = textarea;
  const selected = value.slice(selectionStart, selectionEnd);
  if (selected.length > 0) {
    textarea.setRangeText(`${open}\n${selected}\n${close}`, selectionStart, selectionEnd, "select");
    return;
  }
  textarea.setRangeText(`${open}\n\n${close}`, selectionStart, selectionEnd);
  textarea.selectionStart = selectionStart + open.length + 1;
  textarea.selectionEnd = selectionStart + open.length + 1;
}

/** The [start, end) character range spanning the lines under the selection. */
function lineSpan(textarea: HTMLTextAreaElement): { start: number; end: number } {
  const { selectionStart, selectionEnd, value } = textarea;
  const start = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const end = value.indexOf("\n", selectionEnd) === -1
    ? value.length
    : value.indexOf("\n", selectionEnd);
  return { start, end };
}

function prefixLines(textarea: HTMLTextAreaElement, prefix: string): void {
  const { selectionStart, selectionEnd, value } = textarea;
  const { start, end } = lineSpan(textarea);
  const lines = value.slice(start, end).split("\n");
  // Toggle: every line already carrying the prefix drops it, otherwise
  // every line gains it - clicking twice is undo.
  const all = lines.every((line) => line.startsWith(prefix));
  const updated = lines
    .map((line) => all ? line.slice(prefix.length) : `${prefix}${line}`)
    .join("\n");
  textarea.setRangeText(updated, start, end, "end");
  textarea.selectionStart = selectionStart;
  textarea.selectionEnd = selectionEnd;
}

function numberLines(textarea: HTMLTextAreaElement): void {
  const { selectionStart, selectionEnd, value } = textarea;
  const { start, end } = lineSpan(textarea);
  const lines = value.slice(start, end).split("\n");
  const all = lines.every((line, index) => line.startsWith(`${index + 1}. `));
  const updated = lines
    .map((line, index) => all ? line.slice(`${index + 1}. `.length) : `${index + 1}. ${line}`)
    .join("\n");
  textarea.setRangeText(updated, start, end, "end");
  textarea.selectionStart = selectionStart;
  textarea.selectionEnd = selectionEnd;
}

/** Paragraph = body text: no heading, quote or list prefix on any line. */
function stripLinePrefixes(textarea: HTMLTextAreaElement): void {
  const { selectionStart, selectionEnd, value } = textarea;
  const { start, end } = lineSpan(textarea);
  const lines = value.slice(start, end).split("\n");
  const updated = lines.map((line) => line.replace(LINE_PREFIXES, "")).join("\n");
  textarea.setRangeText(updated, start, end, "end");
  textarea.selectionStart = selectionStart;
  textarea.selectionEnd = selectionEnd;
}

function hasMultilineSelection(textarea: HTMLTextAreaElement): boolean {
  const { selectionStart, selectionEnd, value } = textarea;
  return value.slice(selectionStart, selectionEnd).includes("\n");
}
