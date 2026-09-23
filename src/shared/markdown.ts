/**
 * The Markdown pipeline: the document format on disk and the bridge to
 * the editing surface.
 *
 * The renderer edits rich text (HTML) but the document of record is
 * Markdown, so any markdown reader can consume these notes. Saving
 * converts HTML→Markdown (`documentToMarkdown`); loading converts
 * Markdown→HTML (`markdownToDocumentHtml`) and sanitizes the result,
 * so nothing rendered comes from outside the allowlist.
 *
 * Round-tripping is deliberately lossy in the direction the writer
 * cannot see: `<u>` and `<mark>` have no markdown equivalent, so a
 * saved note that had them reads back as plain runs of text. The user's
 * words, structure and emphasis all survive.
 */
import TurndownService from "turndown";
import MarkdownIt from "markdown-it";
import { sanitizeDocumentHtml } from "./html.ts";

const turndown = new TurndownService({
  headingStyle: "atx", // # headings, the markdown the toolbar implies
  codeBlockStyle: "fenced", // ``` blocks, not four-space indentation
  bulletListMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
  hr: "---",
});

// A visible line break (<br>) saves as a single newline - not GFM's
// two trailing spaces, which read as accidental whitespace and vanish
// in editors that trim lines. The `br` constructor option does not
// accept this, hence the rule.
turndown.addRule("br", {
  filter: "br",
  replacement: () => "\n",
});

// `u` and `mark` have no markdown equivalent; keep them as inline HTML
// so a document carrying them loses nothing on a save/load cycle.
turndown.keep(["u", "mark"]);

// Strikethrough is not in turndown's default vocabulary; `~~` is the
// GFM syntax every markdown reader understands.
turndown.addRule("strikethrough", {
  filter: ["s", "del"],
  replacement: (content) => `~~${content}~~`,
});

/**
 * A pipe cell text needs `|` escaped or it would split the cell. The
 * newline turndown would otherwise keep inside a cell must go too: a
 * cell is one line of the pipe row, so a soft break becomes a space.
 */
function pipeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

/** The GFM separator row for a header's alignment values. */
function pipeSeparator(alignment: (string | null)[]): string {
  return alignment
    .map((value) => {
      switch (value) {
        case "center": return ":---:";
        case "right": return "---:";
        case "left": return ":---";
        default: return "---";
      }
    })
    .join(" | ");
}

/**
 * Tables save as GFM pipe syntax, the dialect every markdown reader
 * understands (and the one markdown-it renders back). Turndown has no
 * table support at all, so the whole element is walked by hand: the
 * header row's cells define the columns and every body row pads or
 * truncates to that width, so the saved pipes always line up.
 *
 * Cell content is plain text: a `<br>` inside a cell becomes a space,
 * and inline markup already reached this rule as text via the inner
 * rules that ran first. Alignment rides the `align` attribute the
 * round-trip preserves.
 */
turndown.addRule("table", {
  filter: "table",
  replacement: (_content, node) => {
    const table = node as HTMLTableElement;
    const headerCells = Array.from(table.querySelectorAll("thead th"));
    const rows = Array.from(table.querySelectorAll("tbody tr"));
    if (headerCells.length === 0) return ""; // No columns to speak of.

    const header = headerCells.map((cell) => pipeCell(cell.textContent ?? ""));
    const alignment = headerCells.map((cell) => cell.getAttribute("align"));
    const lines = [
      `| ${header.join(" | ")} |`,
      `| ${pipeSeparator(alignment)} |`,
      ...rows.map((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        const padded = header.map((_, index) => pipeCell(cells[index]?.textContent ?? ""));
        return `| ${padded.join(" | ")} |`;
      }),
    ];
    return `\n\n${lines.join("\n")}\n\n`;
  },
});

// `breaks` renders a single newline as a visible line break (<br>),
// matching what the writer sees in the source editor: one Enter = one
// new line on screen. Without it, two typed lines silently merge into
// one paragraph the moment the rich view re-renders - the classic
// markdown surprise, and here it reads as a round-trip bug.
//
// `html: true` matters for the same fidelity: formats without markdown
// syntax (underline, highlight) are stored as inline HTML, and must
// render back as formatting - not as visible `<u>` text. Raw HTML is
// still safe: every load passes through the sanitizer allowlist right
// after this, which strips scripts, handlers and unknown tags.
const markdownIt = new MarkdownIt({ html: true, linkify: false, breaks: true });

// markdown-it writes column alignment as an inline style
// (`style="text-align:right"`), which the sanitizer strips - styles
// are not carried through. The `align` attribute says the same thing,
// is on the sanitizer allowlist, and is what the turndown table rule
// reads back, so alignment survives the load/save round-trip.
for (const tag of ["th_open", "td_open"] as const) {
  markdownIt.renderer.rules[tag] = (tokens, idx, options, _env, self) => {
    const token = tokens[idx]!;
    const attrs: [string, string][] = (token.attrs ?? []) as [string, string][];
    const style = attrs.find(([name]) => name === "style")?.[1];
    const match = style ? /text-align:\s*(\w+)/.exec(style) : null;
    if (match) token.attrSet("align", match[1]!);
    // The style attribute itself stays; the sanitizer strips it, while
    // `align` rides the allowlist through to the editor and back out.
    return self.renderToken(tokens, idx, options);
  };
}

/** Editing-surface HTML → the Markdown stored on disk. */
export function documentToMarkdown(html: string): string {
  return turndown.turndown(html).trim();
}

/** Stored Markdown → sanitized editing-surface HTML. */
export function markdownToDocumentHtml(markdown: string): string {
  const raw = markdownIt.render(markdown);
  return sanitizeDocumentHtml(raw).trim();
}

/**
 * True when a stored document looks like legacy editor HTML rather
 * than Markdown. First-launch notes and markdown documents both hit
 * the fast path; only genuine legacy saves migrate.
 */
export function looksLikeLegacyHtml(text: string): boolean {
  return /^\s*</.test(text) && /<\/(p|h1|h2|h3|div|ul|ol|blockquote|pre)>/i.test(text);
}
