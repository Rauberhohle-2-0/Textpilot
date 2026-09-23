/**
 * The formatting toolbar.
 *
 * Built from `FORMAT_ACTIONS`, one button each, grouped into block and
 * inline formats. On every selection change inside the document it asks
 * the browser which formats are active and lights the buttons up - the
 * toolbar reads state rather than tracking it, so it cannot drift.
 *
 * Buttons are `mousedown` + `preventDefault`: clicking must not steal the
 * selection from the document, or the format would apply to nothing.
 */
import { createElement, icons } from "lucide";
import type { Component } from "../../core/component.ts";
import { h } from "../../core/dom.ts";
import { insertMarkdown } from "./markdown-insert.ts";
import {
  FORMAT_ACTIONS,
  STATE_COMMANDS,
  activeBlockTag,
  applyFormat,
  isFormatActive,
  tableHtml,
} from "./formatting.ts";
import type { FormatAction, TableSize } from "./formatting.ts";

export interface ToolbarOptions {
  /** The contenteditable the formats apply to. */
  target: HTMLElement;
  /** The markdown-source textarea; format buttons edit it in source mode. */
  source: HTMLTextAreaElement;
  /** Fired after a format changed the document; the view autosaves. */
  onChange(): void;
  /** Fired when the user toggles markdown-source mode. */
  onToggleSource(): void;
  /** True while the markdown source is on screen. */
  isSourceMode(): boolean;
}

export function createToolbar({
  target,
  source,
  onChange,
  onToggleSource,
  isSourceMode,
}: ToolbarOptions): Component<HTMLElement> & {
  setSourceMode(active: boolean): void;
} {
  const buttons = new Map<string, HTMLButtonElement>();

  // Group 1: block text formats (headings, body). Group 2: everything
  // else - quote, code block, inline emphasis and lists. The split is
  // by id, not by shape: a filter on "has a value" would catch the
  // blockquote/pre commands too and render them twice.
  const BLOCK_GROUP_IDS = new Set(["h1", "h2", "h3", "paragraph"]);
  const groups = [
    FORMAT_ACTIONS.filter((action) => BLOCK_GROUP_IDS.has(action.id)),
    FORMAT_ACTIONS.filter((action) => isListOrInline(action)),
  ];

  const element = h(
    "div",
    { class: "toolbar", role: "toolbar", "aria-label": "Formatting" },
    ...groups.flatMap((actions, index) => {
      const group = h(
        "div",
        { class: "toolbar-group", role: "group" },
        ...actions.map((action) => buildButton(action)),
      );
      return index < groups.length - 1
        ? [group, h("span", { class: "toolbar-separator" })]
        : [group];
    }),
    h("span", { class: "toolbar-separator" }),
    buildSourceToggle(),
  );

  function buildButton(action: FormatAction): HTMLButtonElement {
    const button = h("button", {
      type: "button",
      class: "toolbar-button",
      title: action.shortcut ? `${action.title} (${action.shortcut})` : action.title,
      "aria-label": action.title,
      "data-format": action.id,
    });
    button.append(createElement(icons[pascal(action.icon) as keyof typeof icons]));
    // mousedown, not click: a click would move focus and drop the
    // selection before the command runs.
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      if (isSourceMode()) {
        // Source mode: edit the markdown text directly. The textarea
        // regains focus so typing continues where the edit happened.
        insertMarkdown(source, action);
        source.focus();
        onChange();
        return;
      }
      if (action.id === "table") {
        openTablePicker(button);
        return;
      }
      applyFormat(action);
      onChange();
      reflect();
    });
    buttons.set(action.id, button);
    return button;
  }

  /**
   * The size picker: hover the table button and a Word-style grid
   * opens under it; move across the cells to grow the highlighted
   * area, click to insert a table of that size at the caret. The
   * grid tracks the pointer on mousemove (not per-cell hover states),
   * so sweeping diagonally always lights exactly the cells under the
   * cursor, and the size label updates in one place.
   */
  function openTablePicker(anchor: HTMLButtonElement): void {
    const MAX = 8;
    let columns = 0;
    let rows = 0;

    const grid = h("div", { class: "table-picker-grid" });
    const cells: HTMLElement[] = [];
    for (let r = 0; r < MAX; r += 1) {
      for (let c = 0; c < MAX; c += 1) {
        const cell = h("div", { class: "table-picker-cell" });
        cells.push(cell);
        grid.append(cell);
      }
    }
    const label = h("div", { class: "table-picker-label" }, "1 × 1");
    const popover = h(
      "div",
      { class: "table-picker", role: "dialog", "aria-label": "Insert table" },
      grid,
      label,
    );

    function highlightTo(r: number, c: number): void {
      columns = c + 1;
      rows = r + 1;
      cells.forEach((cell, index) => {
        cell.classList.toggle("table-picker-cell--lit", index % MAX <= c && Math.floor(index / MAX) <= r);
      });
      label.textContent = `${columns} × ${rows}`;
    }

    grid.addEventListener("mousemove", (event) => {
      const gridBox = grid.getBoundingClientRect();
      const c = Math.min(MAX - 1, Math.max(0, Math.floor(((event.clientX - gridBox.left) / gridBox.width) * MAX)));
      const r = Math.min(MAX - 1, Math.max(0, Math.floor(((event.clientY - gridBox.top) / gridBox.height) * MAX)));
      highlightTo(r, c);
    });
    grid.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      insertTableOfSize({ columns, rows });
      closePicker();
    });
    grid.addEventListener("mouseover", () => grid.classList.add("table-picker-grid--active"));

    function closePicker(): void {
      popover.remove();
      document.removeEventListener("mousedown", onOutside, true);
    }
    function onOutside(event: MouseEvent): void {
      if (!(event.target as Element | null)?.closest?.(".table-picker")) closePicker();
    }

    const anchorBox = anchor.getBoundingClientRect();
    popover.style.left = `${anchorBox.left + anchorBox.width / 2}px`;
    // Clear of the toolbar pill with room to breathe; the transform
    // on .table-picker lifts the popover fully above this point.
    popover.style.top = `${anchorBox.top - 14}px`;
    document.body.append(popover);
    document.addEventListener("mousedown", onOutside, true);
    highlightTo(2, 2); // A 3×3 preview reads as the default.
  }

  /** Insert the picked table at the caret, rich or source mode alike. */
  function insertTableOfSize(size: TableSize): void {
    if (isSourceMode()) {
      insertMarkdown(source, FORMAT_ACTIONS.find((a) => a.id === "table")!, size);
      source.focus();
      onChange();
      return;
    }
    // No execCommand builds a table, so the skeleton goes in as HTML
    // at the caret. The trailing <p> gives the caret a place below the
    // table; the caret itself is parked in the first header cell so
    // typing starts in the table, not after it.
    document.execCommand("insertHTML", false, tableHtml(size));
    const first = target.querySelector("table th");
    if (first) {
      const range = document.createRange();
      range.selectNodeContents(first);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    onChange();
    reflect();
  }

  function isListOrInline(action: FormatAction): boolean {
    // The list ids (`bullet`, `number`) do not share a suffix, so they
    // are named explicitly - a suffix check is how they once fell out
    // of the toolbar silently.
    return action.kind === "inline" ||
      action.id === "bullet" || action.id === "number" ||
      action.id === "blockquote" || action.id === "code" ||
      action.id === "table";
  }

  function pascal(icon: string): string {
    return icon.split("-").map((part) => part[0]!.toUpperCase() + part.slice(1)).join("");
  }

  function buildSourceToggle(): HTMLButtonElement {
    const button = h("button", {
      type: "button",
      class: "toolbar-button",
      title: "Toggle markdown source (⌘/)",
      "aria-label": "Toggle markdown source",
      "aria-pressed": "false",
    });
    button.append(createElement(icons.FileCode));
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      onToggleSource();
    });
    return button;
  }

  /**
   * Source mode keeps the format buttons enabled - they now edit the
   * markdown text directly. Only the reflect loop pauses (browser
   * format state is meaningless for raw markdown), and the toggle
   * lights up so the mode is visible at a glance.
   */
  function setSourceMode(active: boolean): void {
    const toggle = element.querySelector<HTMLButtonElement>("[aria-pressed]");
    if (toggle) {
      toggle.setAttribute("aria-pressed", String(active));
      toggle.classList.toggle("toolbar-button--active", active);
    }
    if (active) {
      for (const button of buttons.values()) {
        button.classList.remove("toolbar-button--active");
      }
    }
  }

  function reflect(): void {
    if (element.querySelector("[aria-pressed]")?.getAttribute("aria-pressed") === "true") return;
    for (const action of FORMAT_ACTIONS) {
      const button = buttons.get(action.id);
      if (!button) continue;
      const active = action.value
        ? activeBlockTag() === action.value
        : STATE_COMMANDS.includes(action.command as (typeof STATE_COMMANDS)[number]) &&
          isFormatActive(action);
      button.classList.toggle("toolbar-button--active", active);
    }
  }

  document.addEventListener("selectionchange", reflect);

  return {
    element,
    setSourceMode,
    destroy() {
      document.removeEventListener("selectionchange", reflect);
    },
  };
}
