import { describe, expect, test } from "bun:test";
import {
  documentToMarkdown,
  looksLikeLegacyHtml,
  markdownToDocumentHtml,
} from "../../src/shared/markdown.ts";

describe("html to markdown", () => {
  test("headings become ATX syntax", () => {
    expect(documentToMarkdown("<h1>Chapter</h1>")).toBe("# Chapter");
    expect(documentToMarkdown("<h2>Scene</h2>")).toBe("## Scene");
    expect(documentToMarkdown("<h3>Beat</h3>")).toBe("### Beat");
  });

  test("emphasis uses the toolbar's markdown dialect", () => {
    expect(documentToMarkdown("<p><b>bold</b> <i>italic</i></p>")).toBe(
      "**bold** *italic*",
    );
    expect(documentToMarkdown("<p><s>gone</s></p>")).toBe("~~gone~~");
  });

  test("lists, quotes and code fences round-trip", () => {
    const markdown = documentToMarkdown(
      "<ul><li>one</li><li>two</li></ul><blockquote><p>quote</p></blockquote><pre><code>x = 1</code></pre>",
    );
    // Turndown pads list items to align continuation lines; valid GFM.
    expect(markdown).toContain("-   one");
    expect(markdown).toContain("-   two");
    expect(markdown).toContain("> quote");
    expect(markdown).toContain("```\nx = 1\n```");
  });

  test("body paragraphs read as plain markdown text", () => {
    expect(documentToMarkdown("<p>plain words</p>")).toBe("plain words");
  });

  test("a soft line break saves as a plain newline, not trailing spaces", () => {
    expect(documentToMarkdown("<p>first<br>second</p>")).toBe("first\nsecond");
  });

  test("a table saves as GFM pipe syntax", () => {
    const markdown = documentToMarkdown(
      "<table><thead><tr><th>a</th><th>b</th></tr></thead>" +
        '<tbody><tr><td align="right">1</td><td>2</td></tr></tbody></table>',
    );
    expect(markdown).toContain("| a | b |");
    expect(markdown).toContain("| --- | --- |");
    expect(markdown).toContain("| 1 | 2 |");
  });

  test("pipe characters inside cells are escaped", () => {
    const markdown = documentToMarkdown(
      "<table><thead><tr><th>x</th></tr></thead><tbody><tr><td>a|b</td></tr></tbody></table>",
    );
    expect(markdown).toContain("a\\|b");
  });
});

describe("markdown to html", () => {
  test("renders what the toolbar reads back", () => {
    const html = markdownToDocumentHtml("# Title\n\n**bold** *italic*\n\n- item");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<li>item</li>");
  });

  test("a single newline renders as a visible line break", () => {
    // Source mode shows one Enter as one new line; the rich view must
    // agree, or lines typed apart silently merge into one paragraph.
    const html = markdownToDocumentHtml("first line\nsecond line");
    expect(html).toContain("first line<br");
    expect(html).toContain("second line");
  });

  test("hostile raw HTML is stripped, benign formatting renders", () => {
    const html = markdownToDocumentHtml(
      'hello <script>bad()</script> <u>underline</u> world',
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("<u>underline</u>");
    expect(html).toContain("world");
  });

  test("javascript links are never rendered as links", () => {
    const html = markdownToDocumentHtml(
      "[bad](javascript:alert(1)) [good](https://ok.example)",
    );
    // markdown-it refuses unsafe URLs and leaves them as visible text;
    // nothing clickable with a javascript: href survives.
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://ok.example"');
  });

  test("a pipe table renders as a real table", () => {
    const html = markdownToDocumentHtml(
      "| a | b |\n| :--- | ---: |\n| 1 | 2 |\n",
    );
    expect(html).toContain("<table>");
    expect(html).toContain('<th align="left">a</th>');
    expect(html).toContain('<td align="right">2</td>');
  });

  test("hostile HTML inside a table cell is stripped", () => {
    const html = markdownToDocumentHtml(
      "| a | b |\n| --- | --- |\n| <script>bad()</script>ok | 2 |\n",
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("<td>ok</td>");
  });
});

describe("round-trip", () => {
  test("a formatted document survives a save/load cycle", () => {
    const original = markdownToDocumentHtml(
      "# Notes\n\n**bold** and *italic*\n\n- item one\n- item two\n",
    );
    const markdown = documentToMarkdown(original);
    const reloaded = markdownToDocumentHtml(markdown);

    expect(markdown).toBe("# Notes\n\n**bold** and *italic*\n\n-   item one\n-   item two");
    expect(reloaded).toContain("<h1>Notes</h1>");
    expect(reloaded).toContain("<strong>bold</strong>");
    expect(reloaded).toContain("<em>italic</em>");
    expect(reloaded).toContain("<li>item one</li>");
  });

  test("a table survives a save/load cycle", () => {
    const original = markdownToDocumentHtml(
      "| name | qty |\n| :--- | ---: |\n| screws | 12 |\n| bolts | 4 |\n",
    );
    const markdown = documentToMarkdown(original);
    const reloaded = markdownToDocumentHtml(markdown);

    expect(markdown).toContain("| name | qty |");
    expect(markdown).toContain("| :--- | ---: |");
    expect(markdown).toContain("| bolts | 4 |");
    expect(reloaded).toContain('<td align="left">screws</td>');
    expect(reloaded).toContain('<td align="right">4</td>');
  });
});

describe("legacy document detection", () => {
  test("recognizes pre-markdown HTML saves", () => {
    expect(looksLikeLegacyHtml("<h1>Old</h1><p>note</p>")).toBe(true);
    expect(looksLikeLegacyHtml("<p>plain</p>")).toBe(true);
    expect(looksLikeLegacyHtml("# Markdown\n\n- item")).toBe(false);
    expect(looksLikeLegacyHtml("just text")).toBe(false);
    expect(looksLikeLegacyHtml("")).toBe(false);
  });
});
