/**
 * The writable space: the whole window is one rich-text document.
 *
 * A contenteditable surface over `EditorStore`. The editing surface is
 * HTML - headings, emphasis, lists while you work - but the document of
 * record is Markdown: saves convert HTML→Markdown, loads render
 * Markdown→HTML and sanitize it, so any markdown reader can consume
 * what this app writes. Markdown input rules let the syntax itself
 * apply formats as it is typed (`## `, `- `, `**bold**`, `~~strike~~`).
 *
 * Saves are debounced: one request per typing pause, not one per
 * keystroke.
 */
import type { Component } from "../../core/component.ts";
import { h } from "../../core/dom.ts";
import { documentToMarkdown, markdownToDocumentHtml, looksLikeLegacyHtml } from "../../../shared/markdown.ts";
import { loadDocument, saveDocument } from "../../backend/documents.ts";
import { createToolbar } from "./toolbar.ts";
import { installInputRules } from "./input-rules.ts";
import { EditorStore } from "./store.ts";
import { createTopBar } from "../topbar/index.ts";

const SAVE_DEBOUNCE_MS = 600;

export type EditorOptions = Record<string, never>;

export function createEditor(_options: EditorOptions = {}): Component<HTMLDivElement> & {
  /** Open a document by id; the save path follows the open one. */
  openDocument(id: string): Promise<void>;
  /** Clear the editor when no document is left to show. */
  showBlank(): void;
} {
  const store = new EditorStore();

  const surface = h("div", {
    id: "writable-space",
    class: EDITOR_CLASS,
    // Editable only once a document is open; `syncEditable` turns it on
    // when one arrives. See that function for why.
    contenteditable: false,
    spellcheck: false,
    "data-placeholder": "Start writing…",
    "aria-label": "Document",
  });

  /** Raw-markdown editing surface; swapped in for the rich one. */
  const source = h("textarea", {
    id: "source-space",
    class: EDITOR_CLASS,
    spellcheck: false,
    placeholder: "# Markdown source…",
    "aria-label": "Markdown source",
  });
  source.hidden = true;

  // True while a store update originated from this surface. Markdown
  // is a lossy view of the HTML being edited (b→strong, spacing), so
  // echoing a local edit back into innerHTML would rewrite the DOM
  // under the caret; only a genuinely new document re-renders.
  let editingLocally = false;
  /** The markdown the surface currently displays. */
  let renderedMarkdown = "";

  function commitLocalEdit(): void {
    editingLocally = true;
    try {
      // The active surface is authoritative: in source mode the
      // textarea holds the markdown of record, otherwise the rich
      // surface does and it must be converted.
      renderedMarkdown = sourceMode ? source.value : documentToMarkdown(surface.innerHTML);
      store.set({ markdown: renderedMarkdown });
    } finally {
      editingLocally = false;
    }
    scheduleSave();
  }

  const toolbar = createToolbar({
    target: surface,
    source,
    onChange: commitLocalEdit,
    onToggleSource: toggleSourceMode,
    isSourceMode: () => sourceMode,
  });

  const disposeInputRules = installInputRules({ target: surface, onChange: commitLocalEdit });

  // The floating top bar: save state + document stats, centered over the
  // document. It subscribes to the store itself, so the editor's own
  // subscriber below stays about rendering text, not chrome.
  const topBar = createTopBar(store);

  const root = h(
    "div",
    { class: "editor relative flex flex-col h-full w-full" },
    surface,
    source,
    topBar,
    toolbar,
  );

  /**
   * Source mode: the textarea shows the markdown of record, the rich
   * surface hides. Switching back re-renders the document from the
   * (possibly hand-edited) source. One way street per toggle: while in
   * source mode the store's markdown is authoritative and the surface
   * is not synced.
   */
  let sourceMode = false;

  function toggleSourceMode(): void {
    sourceMode = !sourceMode;
    if (sourceMode) {
      source.value = store.state.markdown;
      surface.hidden = true;
      source.hidden = false;
      source.focus();
    } else {
      // Enter pressed in source mode left the store stale; commit the
      // hand-edited markdown and render the rich surface from it here.
      // Seeding `renderedMarkdown` first would make the subscriber see
      // "no change" and skip the re-render entirely.
      renderedMarkdown = source.value;
      surface.innerHTML = markdownToDocumentHtml(renderedMarkdown);
      store.set({ markdown: renderedMarkdown });
      surface.hidden = false;
      source.hidden = true;
      surface.focus();
      scheduleSave();
    }
    toolbar.setSourceMode(sourceMode);
  }

  // ⌘/ (Ctrl+/ elsewhere) toggles source mode from anywhere in the
  // document, the same muscle memory as toggling a code viewer.
  function onKeyDown(event: KeyboardEvent): void {
    if ((event.metaKey || event.ctrlKey) && event.key === "/") {
      event.preventDefault();
      toggleSourceMode();
    }
  }
  root.addEventListener("keydown", onKeyDown);

  const unsubscribe = store.subscribe(({ markdown, loaded }) => {
    syncEditable(store.state.documentId);
    // Re-render only when the document itself changed - not when the
    // `saving` flag toggles. Rewriting innerHTML while the save status
    // flickers would drop the caret mid-sentence and restyle the DOM
    // (p margins appearing) under the writer's hands. Never while in
    // source mode: the textarea owns the screen there.
    if (loaded && !editingLocally && !sourceMode && markdown !== renderedMarkdown) {
      surface.innerHTML = markdownToDocumentHtml(markdown);
      renderedMarkdown = markdown;
    }
  });

  /**
   * Accept input only while a document is open.
   *
   * The document is handed to the editor from outside - the sidebar
   * resolves one at boot and opens it - so there is a window where the
   * surface exists but has no document id. Typing in that window lost
   * the text twice: `persist` needs an id and gave up without one, and
   * the load that landed next re-rendered the surface from the file,
   * erasing what had been typed. A read-only surface cannot lose a
   * keystroke it never accepted.
   */
  function syncEditable(documentId: string | null): void {
    const editable = documentId !== null;
    if (surface.isContentEditable !== editable) surface.contentEditable = String(editable);
    source.readOnly = !editable;
    // The placeholder invites writing, so it follows the same state: a
    // read-only surface must not ask for text it will drop.
    const placeholder = editable ? "Start writing…" : "No document open";
    if (surface.dataset.placeholder !== placeholder) surface.dataset.placeholder = placeholder;
  }

  surface.addEventListener("input", commitLocalEdit);

  // Source-mode edits flow through the same commit path; markdown
  // needs no conversion, so it commits directly.
  source.addEventListener("input", () => {
    renderedMarkdown = source.value;
    store.set({ markdown: renderedMarkdown });
    scheduleSave();
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSave(): void {
    clearTimeout(timer);
    timer = setTimeout(() => void persist(), SAVE_DEBOUNCE_MS);
  }

  async function persist(): Promise<void> {
    const id = store.state.documentId;
    if (id === null) return;
    store.set({ saving: true });
    try {
      await saveDocument(id, store.state.markdown);
    } catch (error) {
      report(error);
    } finally {
      store.set({ saving: false });
    }
  }

  function report(error: unknown): void {
    console.error("[editor]", error);
  }

  // Enter must produce real paragraphs: without this the browser
  // inserts bare <div>s, which turndown flattens into single lines and
  // which restyle unpredictably when a document re-renders.
  document.execCommand("defaultParagraphSeparator", false, "p");

  /** Show one document in the surface, dropping any pending save of the previous one. */
  async function openDocument(id: string): Promise<void> {
    clearTimeout(timer);
    try {
      const document = await loadDocument(id);
      const markdown = looksLikeLegacyHtml(document.text)
        ? documentToMarkdown(document.text)
        : document.text;
      renderedMarkdown = ""; // force the subscriber to re-render
      editingLocally = true;
      try {
        store.set({ markdown, documentId: id, loaded: true });
      } finally {
        editingLocally = false;
      }
      if (sourceMode) {
        source.value = markdown;
      } else {
        surface.innerHTML = markdownToDocumentHtml(markdown);
        renderedMarkdown = markdown;
      }
    } catch (error) {
      // Settle the status line rather than spin forever. The document id
      // stays null, so the surface stays read-only - honest about having
      // nowhere to save.
      store.set({ loaded: true });
      report(error);
    }
  }

  /**
   * Clear the surface when there is no document to show - e.g. the
   * last document was deleted. Any pending save of the previous
   * document is dropped first, so it cannot resurrect deleted text.
   */
  function showBlank(): void {
    clearTimeout(timer);
    editingLocally = true;
    try {
      store.set({ markdown: "", documentId: null });
    } finally {
      editingLocally = false;
    }
    renderedMarkdown = "";
    surface.innerHTML = "";
    source.value = "";
  }

  // No boot fetch here on purpose: the sidebar resolves which document
  // to open (creating the first one when the library is empty) and calls
  // `openDocument`. Resolving it here as well is what produced a file the
  // sidebar had never heard of.

  return {
    element: root,
    openDocument,
    showBlank,
    destroy() {
      clearTimeout(timer);
      disposeInputRules();
      root.removeEventListener("keydown", onKeyDown);
      toolbar.destroy?.();
      topBar.destroy?.();
      unsubscribe();
    },
  };
}

// No whitespace-pre-wrap: the rendered document is real block markup
// (p, h1, ul...), so raw newlines between tags must collapse, not show
// as extra blank lines on top of the CSS margins. Soft breaks typed
// with Shift+Enter are real <br> elements and still display.
// Extra bottom padding keeps the last lines clear of the floating toolbar;
// the top padding clears the floating top bar the same way.
const EDITOR_CLASS = [
  "writable-space",
  "flex-1",
  "min-h-0",
  "overflow-y-auto",
  "outline-none",
  "px-10",
  "pt-16",
  "pb-32",
  "caret-[var(--accent)]",
].join(" ");
