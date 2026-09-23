/**
 * Word-style table editor: hover reveals handles, click performs an
 * operation.
 *
 * The overlay is three floating pieces, appended to the editor root
 * and positioned from the hovered table's box:
 *
 * - A column flyout per column: a hover strip above the table whose
 *   handle lights the whole column on hover; clicking opens the
 *   column menu (insert left/right, delete).
 * - A row flyout per row: same construction to the left of the table.
 * - A table menu in the table's top-right corner: insert row/column
 *   (Word's plus buttons) and delete table.
 *
 * Only the table operations touch the document; each ends with one
 * `onChange`, so a mutation costs one autosave cycle - the same shape
 * as a toolbar format. Hovering never touches the undo stack.
 *
 * The overlay re-renders on every mousemove over a table: cheap (a
 * handful of positioned divs) and always in sync with contenteditable
 * churn, which can move or rebuild table boxes at any time.
 */
import { createElement, icons } from "lucide";
import { h } from "../../core/dom.ts";

export interface TableEditorOptions {
  /** The editor root that hosts the overlay and contains tables. */
  root: HTMLElement;
  /** Fired after a mutation changed the document; the view autosaves. */
  onChange(): void;
}

/** The row/column a menu acts on. */
interface TableContext {
  table: HTMLTableElement;
  row: HTMLTableRowElement | null;
  column: number;
}

type Op = {
  label: string;
  icon: keyof typeof icons;
  /** True when running the op on the last column/row removes the table. */
  deletesLast?: boolean;
  run(context: TableContext): void;
};

/* ------------------------------------------------------------------ */
/* Column operations                                                   */
/* ------------------------------------------------------------------ */

function insertColumn(context: TableContext, offset: number): void {
  const { table, row, column } = context;
  const target = column + offset;
  for (const tr of table.querySelectorAll("tr")) {
    const cells = Array.from(tr.querySelectorAll("th,td"));
    const position = Math.min(Math.max(target, 0), cells.length);
    // A new cell in the header row is a th, matching its row; the new
    // column inherits th/td per row rather than as a block.
    const inHeader = tr.parentElement?.tagName === "THEAD";
    const cell = document.createElement(inHeader || cells[position - 1]?.tagName === "TH" ? "th" : "td");
    cells[Math.min(position, cells.length)]?.before(cell);
    if (position >= cells.length) tr.append(cell);
  }
  focusCell(table, row, target);
}

function deleteColumn(context: TableContext): void {
  const { table, column } = context;
  for (const tr of table.querySelectorAll("tr")) {
    tr.querySelectorAll("th,td")[column]?.remove();
  }
  // A table with no columns left is not a table.
  if ((table.querySelector("tr")?.querySelectorAll("th,td").length ?? 0) === 0) {
    table.remove();
  }
}

const COLUMN_OPS: Op[] = [
  { label: "Insert left", icon: "ArrowLeftToLine", run: (c) => insertColumn(c, 0) },
  { label: "Insert right", icon: "ArrowRightToLine", run: (c) => insertColumn(c, 1) },
  { label: "Delete column", icon: "Trash2", deletesLast: true, run: (c) => deleteColumn(c) },
];

/* ------------------------------------------------------------------ */
/* Row operations                                                      */
/* ------------------------------------------------------------------ */

function insertRow(context: TableContext, offset: number): void {
  const { table, row, column } = context;
  if (!row) return;
  const cellTag = row.parentElement?.tagName === "THEAD" && offset === 0 ? "th" : "td";
  const newRow = document.createElement("tr");
  for (let i = 0; i < row.querySelectorAll("th,td").length; i += 1) {
    newRow.append(document.createElement(cellTag));
  }
  if (offset === 0) {
    row.before(newRow);
  } else {
    row.after(newRow);
  }
  focusCell(table, newRow, column);
}

function deleteRow(context: TableContext): void {
  const { table, row } = context;
  if (!row) return;
  row.remove();
  // No rows left at all: the table goes. A table that keeps its header
  // but loses every body row is still legal GFM (header-only tables
  // round-trip as a single row), so only true emptiness deletes.
  if (table.querySelectorAll("tr").length === 0) table.remove();
}

const ROW_OPS: Op[] = [
  { label: "Insert above", icon: "ArrowUpToLine", run: (c) => insertRow(c, 0) },
  { label: "Insert below", icon: "ArrowDownToLine", run: (c) => insertRow(c, 1) },
  { label: "Delete row", icon: "Trash2", deletesLast: true, run: (c) => deleteRow(c) },
];

/* ------------------------------------------------------------------ */
/* Table operations (the table menu)                                   */
/* ------------------------------------------------------------------ */

const TABLE_OPS: Op[] = [
  { label: "Insert row below", icon: "ArrowDownToLine", run: (c) => insertRow({ table: c.table, row: c.table.querySelector("tbody tr:last-of-type") ?? c.table.querySelector("tr:last-of-type"), column: 0 }, 1) },
  { label: "Insert column right", icon: "ArrowRightToLine", run: (c) => insertColumn({ table: c.table, row: null, column: Math.max(columnCount(c.table) - 1, 0) }, 1) },
  { label: "Delete table", icon: "Trash2", run: (c) => c.table.remove() },
];

/* ------------------------------------------------------------------ */
/* Overlay                                                             */
/* ------------------------------------------------------------------ */

export function installTableEditor({ root, onChange }: TableEditorOptions): () => void {
  const layer = h("div", { class: "table-editor-layer" });

  let activeTable: HTMLTableElement | null = null;
  let menu: HTMLElement | null = null;
  let pinned: { table: HTMLTableElement; context: TableContext } | null = null;

  root.append(layer);

  root.addEventListener("mouseover", onOver);
  root.addEventListener("mouseleave", hide);
  document.addEventListener("mousedown", onDocumentMousedown, true);

  return () => {
    root.removeEventListener("mouseover", onOver);
    root.removeEventListener("mouseleave", hide);
    document.removeEventListener("mousedown", onDocumentMousedown, true);
    layer.remove();
  };

  function onOver(event: MouseEvent): void {
    const table = (event.target as Element | null)?.closest?.("table");
    if (table && root.contains(table)) show(table);
    else if (!pinned) hide();
  }

  function onDocumentMousedown(event: MouseEvent): void {
    if (!(event.target as Element | null)?.closest?.(".table-editor-layer")) pinned = null;
  }

  function show(table: HTMLTableElement): void {
    if (table === activeTable && !pinned) return;
    activeTable = table;
    render();
  }

  function hide(): void {
    if (pinned) return;
    activeTable = null;
    pinned = null;
    render();
  }

  function render(): void {
    layer.replaceChildren();
    closeMenu();
    if (!activeTable) return;
    const table = activeTable;
    const tableBox = table.getBoundingClientRect();
    const rootBox = root.getBoundingClientRect();

    layer.append(buildColumnFlyouts(table, tableBox, rootBox));
    layer.append(buildRowFlyouts(table, tableBox, rootBox));
    layer.append(buildTableMenuButton(table, tableBox, rootBox));

    if (pinned && pinned.table === table) highlight(pinned.context);
  }

  function tableContext(table: HTMLTableElement, index: number): TableContext {
    const rows = Array.from(table.querySelectorAll("tr"));
    return { table, row: rows[0] ?? null, column: index };
  }

  function rowContext(table: HTMLTableElement, row: HTMLTableRowElement): TableContext {
    return { table, row, column: 0 };
  }

  function buildColumnFlyouts(table: HTMLTableElement, tableBox: DOMRect, rootBox: DOMRect): HTMLElement {
    const flyout = h("div", { class: "table-col-flyouts" });
    const columns = columnCount(table);
    for (let index = 0; index < columns; index += 1) {
      const cell = cellAt(table, 0, index);
      const nextCell = cellAt(table, 0, index + 1);
      const left = cell ? cell.getBoundingClientRect().left - rootBox.left : 0;
      const width = cell && nextCell
        ? nextCell.getBoundingClientRect().left - cell.getBoundingClientRect().left
        : 44;
      const context = tableContext(table, index);

      const strip = h(
        "div",
        {
          class: "table-col-strip",
          style: `left:${left}px;width:${width}px;top:${tableBox.top - rootBox.top - 22}px;height:22px`,
        },
      );
      const handle = h("button", {
        type: "button",
        class: "table-col-handle",
        title: `Column ${index + 1}`,
        "aria-label": `Column ${index + 1} actions`,
      });
      strip.append(handle);
      strip.addEventListener("mouseenter", () => highlight(context));
      strip.addEventListener("mouseleave", () => {
        if (!pinned) clearHighlight();
      });
      strip.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        pinned = { table, context };
        highlight(context);
        openMenu("column", context, strip);
      });
      flyout.append(strip);
    }
    return flyout;
  }

  function buildRowFlyouts(table: HTMLTableElement, tableBox: DOMRect, rootBox: DOMRect): HTMLElement {
    const flyout = h("div", { class: "table-row-flyouts" });
    const rows = Array.from(table.querySelectorAll("tr"));
    rows.forEach((row, index) => {
      const firstCell = row.querySelector("th,td");
      if (!firstCell) return;
      const cellBox = firstCell.getBoundingClientRect();
      const top = cellBox.top - rootBox.top;
      const height = cellBox.height;
      const context = rowContext(table, row);

      const strip = h(
        "div",
        {
          class: "table-row-strip",
          style: `top:${top}px;height:${height}px;left:${tableBox.left - rootBox.left - 22}px;width:22px`,
        },
      );
      const handle = h("button", {
        type: "button",
        class: "table-row-handle",
        title: `Row ${index + 1}`,
        "aria-label": `Row ${index + 1} actions`,
      });
      strip.append(handle);
      strip.addEventListener("mouseenter", () => highlight(context));
      strip.addEventListener("mouseleave", () => {
        if (!pinned) clearHighlight();
      });
      strip.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        pinned = { table, context };
        highlight(context);
        openMenu("row", context, strip);
      });
      flyout.append(strip);
    });
    return flyout;
  }

  function buildTableMenuButton(table: HTMLTableElement, tableBox: DOMRect, rootBox: DOMRect): HTMLElement {
    const button = h("button", {
      type: "button",
      class: "table-menu-button",
      title: "Table actions",
      "aria-label": "Table actions",
      style: `left:${tableBox.right - rootBox.left + 6}px;top:${tableBox.top - rootBox.top - 10}px`,
    });
    button.append(createElement(icons.MoreHorizontal));
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      pinned = { table, context: tableContext(table, 0) };
      openMenu("table", pinned.context, button);
    });
    return button;
  }

  function openMenu(kind: "column" | "row" | "table", context: TableContext, anchor: Element): void {
    closeMenu();
    const ops = kind === "column" ? COLUMN_OPS : kind === "row" ? ROW_OPS : TABLE_OPS;
    const table = context.table;
    const isLast = kind === "column"
      ? columnCount(table) === 1
      : kind === "row"
        ? table.querySelectorAll("tr").length === 1
        : false;

    menu = h("div", { class: "table-menu", role: "menu" });
    for (const op of ops) {
      const item = h(
        "button",
        {
          type: "button",
          class: "table-menu-item",
          role: "menuitem",
          ...(op.deletesLast && isLast ? { title: "Deletes the table" } : {}),
        },
      );
      item.append(createElement(icons[op.icon]));
      item.append(h("span", { class: "table-menu-label" }, op.label));
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        op.run(context);
        pinned = null;
        onChange();
        // The mutation may have moved or removed the table; re-render
        // against whatever is now under the pointer, or nothing.
        activeTable = table.isConnected ? table : null;
        render();
      });
      menu.append(item);
    }

    const anchorBox = anchor.getBoundingClientRect();
    const rootBox = root.getBoundingClientRect();
    menu.style.left = `${anchorBox.left - rootBox.left}px`;
    menu.style.top = `${anchorBox.bottom - rootBox.top + 4}px`;
    layer.append(menu);
  }

  function closeMenu(): void {
    menu?.remove();
    menu = null;
  }

  function highlight(context: TableContext): void {
    clearHighlight();
    const { table, row, column } = context;
    for (const tr of table.querySelectorAll("tr")) {
      const cell = tr.querySelectorAll("th,td")[column];
      if (cell && !row) cell.classList.add("table-cell--hl");
    }
    if (row) {
      for (const cell of row.querySelectorAll("th,td")) cell.classList.add("table-cell--hl");
    }
  }

  function clearHighlight(): void {
    for (const cell of root.querySelectorAll(".table-cell--hl")) {
      cell.classList.remove("table-cell--hl");
    }
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function columnCount(table: HTMLTableElement): number {
  return table.querySelector("tr")?.querySelectorAll("th,td").length ?? 0;
}

function cellAt(table: HTMLTableElement, rowIndex: number, columnIndex: number): HTMLTableCellElement | null {
  const cell = table.querySelectorAll("tr")[rowIndex]?.querySelectorAll("th,td")[columnIndex];
  return cell instanceof HTMLTableCellElement ? cell : null;
}

/** Move the caret into a cell after a mutation, so typing continues there. */
function focusCell(table: HTMLTableElement, row: HTMLTableRowElement | null, column: number): void {
  const target = row?.querySelectorAll("th,td")[column] ?? cellAt(table, 0, column);
  if (!target) return;
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
