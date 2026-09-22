/**
 * Document statistics for the floating top bar.
 *
 * Pure functions over the Markdown of record, so they stay trivially
 * testable and never touch the DOM. Word counting runs against visible
 * text: fenced code markers and common Markdown punctuation are
 * stripped first so `# hello` counts as one word, not two.
 */

const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

/** Words the reader sees; Markdown syntax itself is not counted. */
export function countWords(markdown: string): number {
  const text = stripMarkdown(markdown);
  if (text.trim() === '') return 0;
  return text.match(WORD_PATTERN)?.length ?? 0;
}

/** Non-whitespace characters - the companion figure next to words. */
export function countCharacters(markdown: string): number {
  return stripMarkdown(markdown).replace(/\s+/g, '').length;
}

/** Whole minutes at ~200 wpm; 0 words reads as 0, never 1. */
export function readingMinutes(words: number): number {
  if (words <= 0) return 0;
  return Math.max(1, Math.ceil(words / 200));
}

function stripMarkdown(markdown: string): string {
  return (
    markdown
      // Fenced code blocks keep their content, lose the fence markers.
      .replace(/```/g, ' ')
      // Images keep alt text, lose URL + markup: ![alt](url) -> alt.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Links keep label, lose URL: [label](url) -> label.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Autolinks / raw URLs are not readable words.
      .replace(/https?:\/\/\S+/g, ' ')
      // Remaining structural punctuation.
      .replace(/[#>*`~_+=|\\\-:]/g, ' ')
  );
}
