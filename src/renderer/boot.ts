/**
 * Composition root of the UI.
 *
 * Knows the features and mounts them. Anything cross-cutting - here the
 * shared status line - is wired here rather than hidden inside a feature,
 * so features stay independent and the shell stays boring.
 */
import type { Component } from "./core/index.ts";
import { h } from "./core/dom.ts";
import { createEditor } from "./features/editor/index.ts";
import { createSidebar } from "./features/sidebar/index.ts";
import "./styles/main.css";

export function boot(root: HTMLElement = document.body): void {
  const features: Component[] = [];

  // Native title-bar strip: an empty, non-interactive band at the top of
  // the window. The runtime moves the window from this band and maximises
  // on double-click - but only where the page leaves it empty. The editor
  // below is one big contenteditable surface, so without this strip every
  // pixel of the band lands in editable text and the runtime never sees
  // an empty-space press (no drag, no double-click zoom).
  //
  // The sidebar spans the full window height - traffic lights floating
  // over it, macOS source-list style - so the strip only sits over the
  // editor column. The sidebar carries its own drag band inside.
  const shell = h("div", {
    class: "flex flex-row h-screen w-screen overflow-hidden",
  });
  const titleBar = h("header", {
    class: "titlebar-spacer",
    "data-vantail-drag": "",
    "aria-hidden": "true",
  });
  const editorColumn = h("div", { class: "flex-1 min-w-0 flex flex-col" });

  const editor = createEditor();
  features.push(editor);
  const sidebar = createSidebar({
    onOpenDocument(id) {
      void editor.openDocument(id);
    },
    onDocumentDeleted(nextId) {
      if (nextId !== null) {
        void editor.openDocument(nextId);
        return;
      }
      // The last document is gone: give the editor a blank canvas so
      // a deleted document's text cannot linger on screen.
      editor.showBlank();
    },
  });
  features.push(sidebar);

  editorColumn.append(titleBar, editor.element);
  shell.append(sidebar.element, editorColumn);
  root.append(shell);

  window.addEventListener("beforeunload", () => {
    for (const feature of features) feature.destroy?.();
  });
}
