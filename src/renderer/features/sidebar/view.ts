/**
 * The sidebar: documents and folders, Finder-style.
 *
 * A left rail rendering the tree - folders (nested to any depth) and
 * documents interleaved in one list, ordered by position, expandable.
 * Rows accept drag & drop: a document or folder dragged onto a folder
 * moves inside it; dropped on a row's edge it reorders between
 * siblings. Folders live exactly where the user drops them - no pinning
 * to the top.
 */
import { createElement, icons } from "lucide";
import type { Component } from "../../core/component.ts";
import { h } from "../../core/dom.ts";
import type { DocumentMeta } from "../../../shared/documents.ts";
import {
  orderTree,
  positionBetween,
  type FolderMeta,
  type TreeDocument,
  type TreeEntry,
} from "../../../shared/folders.ts";
import {
  createDocument,
  createFolder,
  deleteDocument,
  deleteFolder,
  listDocuments,
  listFolders,
  moveDocument,
  moveFolder,
  renameDocument,
  renameFolder,
} from "./api.ts";

export interface SidebarOptions {
  /** Fired with the document id the user picked (or created). */
  onOpenDocument(id: string): void;
  /** Fired after a document was deleted, with the next one to show. */
  onDocumentDeleted(id: string | null): void;
}

/** Width bounds and default, in px - the CSS fallback stays in sync. */
const MIN_WIDTH = 180;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 216; // 13.5rem
const RESIZE_STEP = 16; // one arrow-key press
const WIDTH_STORAGE_KEY = "textpilot.sidebar-width";
const VISIBILITY_STORAGE_KEY = "textpilot.sidebar-hidden";
const EXPANDED_STORAGE_KEY = "textpilot.sidebar-expanded";

export function createSidebar({
  onOpenDocument,
  onDocumentDeleted,
}: SidebarOptions): Component<HTMLElement> {
  let documents: DocumentMeta[] = [];
  let folders: FolderMeta[] = [];
  /** The document currently shown in the editor, mirrored for selection. */
  let selectedId: string | null = null;
  /** The row currently being renamed inline, if any. */
  let renamingId: string | null = null;
  /** Collapsed folder ids; expanded by default. */
  const collapsed = new Set<string>(
    JSON.parse(window.localStorage.getItem(EXPANDED_STORAGE_KEY) ?? "[]") as string[],
  );

  function storeExpanded(): void {
    window.localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify([...collapsed]));
  }

  /** Whether the rail is hidden; restored from the previous session. */
  let hidden = window.localStorage.getItem(VISIBILITY_STORAGE_KEY) === "1";

  function setHidden(next: boolean): void {
    hidden = next;
    document.body.classList.toggle("sidebar-hidden", hidden);
    window.localStorage.setItem(VISIBILITY_STORAGE_KEY, hidden ? "1" : "0");
  }
  setHidden(hidden); // apply the restored state before first paint

  let width = clampWidth(
    Number(window.localStorage.getItem(WIDTH_STORAGE_KEY)) || DEFAULT_WIDTH,
  );

  function clampWidth(px: number): number {
    return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, px)));
  }

  function setWidth(px: number): void {
    width = clampWidth(px);
    document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
    handle.setAttribute("aria-valuenow", String(width));
  }

  function storeWidth(): void {
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(width));
  }

  const list = h("ul", { class: "sidebar-list", role: "list" });

  const newButton = h(
    "button",
    {
      type: "button",
      class: "sidebar-new-button",
      title: "New document",
      "aria-label": "New document",
    },
    createElement(icons.SquarePen),
  );
  /** Create a document and open it - shared by both new buttons. */
  async function createAndOpenDocument(button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    try {
      const created = await createDocument();
      documents = [...documents, created];
      selectedId = created.id;
      renderList();
      onOpenDocument(created.id);
    } catch (error) {
      console.error("[sidebar]", error);
    } finally {
      button.disabled = false;
    }
  }
  newButton.addEventListener("click", () => void createAndOpenDocument(newButton));

  // Twin of the header's new-document button for the collapsed rail:
  // pinned next to the panel toggle, shown only while the sidebar is
  // hidden (the header pair is then out of sight too). No folder twin -
  // the collapsed rail keeps just the essentials.
  const newHiddenButton = h(
    "button",
    {
      type: "button",
      class: "sidebar-new-button sidebar-new-button--hidden-rail",
      title: "New document",
      "aria-label": "New document",
    },
    createElement(icons.SquarePen),
  );
  newHiddenButton.addEventListener("click", () => void createAndOpenDocument(newHiddenButton));

  // New folder: sits beside the new-document button in the title bar.
  const newFolderButton = h(
    "button",
    {
      type: "button",
      class: "sidebar-new-folder-button",
      title: "New folder",
      "aria-label": "New folder",
    },
    createElement(icons.FolderPlus),
  );
  newFolderButton.addEventListener("click", async () => {
    newFolderButton.disabled = true;
    try {
      const folder = await createFolder("New Folder");
      folders = [...folders, folder];
      // Drop straight into the inline rename so the user names the
      // folder up front instead of accepting "New Folder".
      beginRename(folder.id);
    } catch (error) {
      console.error("[sidebar]", error);
    } finally {
      newFolderButton.disabled = false;
    }
  });

  const toggle = h(
    "button",
    {
      type: "button",
      class: "sidebar-toggle",
      title: "Toggle sidebar",
      "aria-label": "Toggle sidebar",
      "aria-expanded": String(!hidden),
    },
    createElement(icons.PanelLeft),
  );
  toggle.addEventListener("click", () => {
    setHidden(!hidden);
    toggle.setAttribute("aria-expanded", String(!hidden));
  });

  const handle = h("div", {
    class: "sidebar-resize-handle",
    role: "separator",
    "aria-orientation": "vertical",
    "aria-label": "Resize sidebar",
    "aria-valuemin": String(MIN_WIDTH),
    "aria-valuemax": String(MAX_WIDTH),
    title: "Drag to resize - double-click to reset",
    tabindex: "0",
  });

  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("sidebar-resizing");

    const onMove = (move: PointerEvent): void => {
      setWidth(startWidth + move.clientX - startX);
    };
    const onUp = (up: PointerEvent): void => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.releasePointerCapture(up.pointerId);
      document.body.classList.remove("sidebar-resizing");
      storeWidth();
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  });

  handle.addEventListener("dblclick", () => {
    setWidth(DEFAULT_WIDTH);
    window.localStorage.removeItem(WIDTH_STORAGE_KEY);
  });

  handle.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setWidth(width + (event.key === "ArrowRight" ? RESIZE_STEP : -RESIZE_STEP));
    storeWidth();
  });

  setWidth(width);

  const root = h(
    "nav",
    { class: "sidebar", "aria-label": "Documents" },
    h("div", { class: "sidebar-drag-band", "data-vantail-drag": "" }),
    h(
      "div",
      { class: "sidebar-scroll" },
      h(
        "div",
        { class: "sidebar-section" },
        h(
          "div",
          { class: "sidebar-header" },
          h("span", { class: "sidebar-header-label" }, "Documents"),
          h("span", { class: "sidebar-header-actions" }, newFolderButton, newButton),
        ),
        list,
      ),
    ),
    handle,
  );

  // The collapsed-rail twin is toggled with the same body class the
  // hidden state uses, so it never needs its own visibility bookkeeping.
  // The collapsed-rail twin is toggled with the same body class the
  // hidden state uses, so it never needs its own visibility bookkeeping.
  document.body.append(toggle, newHiddenButton);

  // ------------------------------------------------------------------
  // Drag & drop
  // ------------------------------------------------------------------

  type DropMode = "into" | "before" | "after";
  interface DragPayload {
    kind: "document" | "folder";
    id: string;
  }
  let drag: DragPayload | null = null;

  function entryId(entry: TreeEntry): string {
    return entry.kind === "folder" ? entry.folder.id : entry.document.id;
  }

  /**
   * Sibling positions around a drop target: the entry's position and
   * its previous sibling's, used to compute the midpoint.
   */
  function siblingPositions(targetId: string, parentId: string | null): {
    target: number | null;
    before: number | null;
  } {
    const isFolder = folders.some((folder) => folder.id === targetId);
    const siblings: { id: string; position: number }[] = [
      ...folders
        .filter((folder) => (folder.parentId ?? null) === parentId)
        .map((folder) => ({ id: folder.id, position: folder.position })),
      ...documents
        .filter((document) => (document.parentId ?? null) === parentId)
        .map((document) => ({ id: document.id, position: document.position ?? 0 })),
    ].sort((a, b) => a.position - b.position);
    const index = siblings.findIndex((sibling) => sibling.id === targetId);
    if (index === -1) return { target: null, before: null };
    return {
      target: siblings[index]!.position,
      before: index > 0 ? siblings[index - 1]!.position : null,
    };
  }

  function applyDrop(
    payload: DragPayload,
    mode: DropMode,
    target: TreeEntry,
  ): void {
    const targetId = entryId(target);
    if (payload.id === targetId) return;
    const targetIsFolder = target.kind === "folder";
    const targetParent = targetIsFolder
      ? target.folder.parentId
      : (target.document.parentId ?? null);
    const targetPos = targetIsFolder ? target.folder.position : (target.document.position ?? 0);

    if (mode === "into") {
      // Drop into a folder: last position inside it.
      if (payload.kind === "folder" && targetId !== undefined) {
        const inside = folders.filter((folder) => (folder.parentId ?? null) === targetId);
        const position = inside.length > 0 ? Math.max(...inside.map((f) => f.position)) + 1024 : 0;
        void moveFolder(payload.id, targetId, position).then(refresh);
        return;
      }
      const insideDocs = documents.filter(
        (document) => (document.parentId ?? null) === targetId,
      );
      const insideFolders = folders.filter((folder) => (folder.parentId ?? null) === targetId);
      const positions = [
        ...insideDocs.map((d) => d.position ?? 0),
        ...insideFolders.map((f) => f.position),
      ];
      const position = positions.length > 0 ? Math.max(...positions) + 1024 : 0;
      void moveDocument(payload.id, targetId, position).then(refresh);
      return;
    }

    // Before/after: same parent as the target, position between it and
    // the neighbor on the drop side.
    const { target: tPos, before } = siblingPositions(targetId, targetParent ?? null);
    const position =
      mode === "before"
        ? positionBetween(before, tPos ?? targetPos)
        : positionBetween(tPos ?? targetPos, null);
    if (payload.kind === "folder") {
      void moveFolder(payload.id, targetParent ?? null, position).then(refresh);
    } else {
      void moveDocument(payload.id, targetParent ?? null, position).then(refresh);
    }
  }

  /** A dragged folder may never drop into its own subtree. */
  function isOwnSubtree(payload: DragPayload, target: TreeEntry): boolean {
    if (payload.kind !== "folder" || target.kind !== "folder") return false;
    const doomed = new Set<string>([payload.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const folder of folders) {
        if (folder.parentId !== null && doomed.has(folder.parentId) && !doomed.has(folder.id)) {
          doomed.add(folder.id);
          grew = true;
        }
      }
    }
    return doomed.has(target.folder.id);
  }

  function wireDrop(row: HTMLElement, entry: TreeEntry): void {
    row.addEventListener("dragover", (event) => {
      if (!drag) return;
      if (isOwnSubtree(drag, entry)) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = "move";
      const rect = row.getBoundingClientRect();
      const ratio = (event.clientY - rect.top) / rect.height;
      const mode: DropMode = entry.kind === "folder" && ratio > 0.3 && ratio < 0.7 ? "into" : ratio < 0.5 ? "before" : "after";
      row.dataset.dropMode = mode;
      row.classList.add("drop-target");
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("drop-target");
      delete row.dataset.dropMode;
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      const mode = (row.dataset.dropMode ?? "into") as DropMode;
      row.classList.remove("drop-target");
      delete row.dataset.dropMode;
      if (!drag) return;
      applyDrop(drag, mode, entry);
      drag = null;
    });
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------

  /**
   * Inline rename: double-click a row (or double-click semantics via
   * two clicks on the already-selected row) to swap the title for an
   * input. Enter commits, Escape cancels, blur commits. The input is
   * rendered during list build (`renamingId` state), because a click
   * handler that mutates a detached node would never be seen - every
   * click re-renders the whole list.
   */
  let lastClickedId: string | null = null;
  let lastClickTime = 0;

  function beginRename(id: string): void {
    renamingId = id;
    renderList();
  }

  function finishRename(save: boolean, id: string, rawName: string, currentName: string): void {
    renamingId = null;
    const name = rawName.trim();
    if (save && name.length > 0 && name !== currentName) {
      const isFolder = folders.some((folder) => folder.id === id);
      const applyLocal = isFolder
        ? (folders = folders.map((entry) => (entry.id === id ? { ...entry, name } : entry)))
        : (documents = documents.map((entry) => (entry.id === id ? { ...entry, title: name } : entry)));
      void applyLocal;
      const commit = isFolder ? renameFolder(id, name) : renameDocument(id, name);
      void commit
        .catch((error) => console.error("[sidebar]", error))
        .finally(() => void refresh());
    } else {
      renderList();
    }
  }

  /** Whether a second click on this row lands soon enough to rename. */
  function isRenameClick(id: string): boolean {
    const now = Date.now();
    const isDouble = lastClickedId === id && now - lastClickTime < 400;
    lastClickedId = id;
    lastClickTime = now;
    return isDouble;
  }

  function buildRenameInput(
    id: string,
    currentName: string,
  ): HTMLInputElement {
    const input = h("input", {
      type: "text",
      class: "sidebar-rename-input",
      value: currentName,
      "aria-label": "Rename",
    }) as HTMLInputElement;
    let done = false;
    const finish = (save: boolean): void => {
      if (done) return;
      done = true;
      finishRename(save, id, input.value, currentName);
    };
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") finish(true);
      else if (event.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("dblclick", (event) => event.stopPropagation());
    // Focus after the list is in the DOM (renderList replaces children
    // synchronously, so this microtask is enough).
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    return input;
  }

  function folderRow(folder: FolderMeta, depth: number): HTMLLIElement {
    const isCollapsed = collapsed.has(folder.id);

    // Per-folder creation: hovering the row reveals add buttons that
    // put a new document or subfolder directly inside this folder -
    // no dragging required.
    const addDocumentButton = h(
      "button",
      {
        type: "button",
        class: "sidebar-row-action",
        title: `New document in ${folder.name}`,
        "aria-label": `New document in ${folder.name}`,
      },
      createElement(icons.FilePlus),
    );
    addDocumentButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      addDocumentButton.disabled = true;
      try {
        const created = await createDocument("", folder.id);
        documents = [...documents, created];
        if (collapsed.has(folder.id)) {
          collapsed.delete(folder.id);
          storeExpanded();
        }
        selectedId = created.id;
        renderList();
        onOpenDocument(created.id);
      } catch (error) {
        console.error("[sidebar]", error);
      } finally {
        addDocumentButton.disabled = false;
      }
    });

    const addFolderButton = h(
      "button",
      {
        type: "button",
        class: "sidebar-row-action",
        title: `New folder in ${folder.name}`,
        "aria-label": `New folder in ${folder.name}`,
      },
      createElement(icons.FolderPlus),
    );
    addFolderButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      addFolderButton.disabled = true;
      try {
        const created = await createFolder("New Folder", folder.id);
        folders = [...folders, created];
        if (collapsed.has(folder.id)) {
          collapsed.delete(folder.id);
          storeExpanded();
        }
        // Same as the top-level button: let the user name it at once.
        beginRename(created.id);
      } catch (error) {
        console.error("[sidebar]", error);
      } finally {
        addFolderButton.disabled = false;
      }
    });

    const deleteButton = h(
      "button",
      {
        type: "button",
        class: "sidebar-delete-button",
        title: "Delete folder",
        "aria-label": `Delete ${folder.name}`,
      },
      createElement(icons.Trash2),
    );
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void handleFolderDelete(folder);
    });

    const chevron = h(
      "button",
      {
        type: "button",
        class: "sidebar-chevron" + (isCollapsed ? " sidebar-chevron--collapsed" : ""),
        title: isCollapsed ? "Expand" : "Collapse",
        "aria-label": isCollapsed ? `Expand ${folder.name}` : `Collapse ${folder.name}`,
        "aria-expanded": String(!isCollapsed),
      },
      createElement(icons.ChevronRight),
    );
    chevron.addEventListener("click", (event) => {
      event.stopPropagation();
      if (collapsed.has(folder.id)) collapsed.delete(folder.id);
      else collapsed.add(folder.id);
      storeExpanded();
      renderList();
    });

    const titleSpan = h(
      "span",
      { class: "sidebar-row-title" },
      renamingId === folder.id ? buildRenameInput(folder.id, folder.name) : folder.name,
    );
    // The row is a div with button semantics, not a <button>: a button
    // may not contain other buttons (chevron, actions, delete), and
    // browsers - WebKit in particular - never dispatch clicks to
    // buttons nested inside one, which left every inner control dead.
    const rowButton = h(
      "div",
      {
        role: "button",
        tabindex: "0",
        class: "sidebar-row sidebar-row--folder",
        title: folder.name,
        draggable: "true",
        dataset: { folderId: folder.id },
      },
      chevron,
      folderIcon(isCollapsed),
      titleSpan,
      addDocumentButton,
      addFolderButton,
      deleteButton,
    );
    const activateRow = (): void => {
      if (renamingId === folder.id) return; // typing in the rename input
      if (isRenameClick(folder.id)) {
        beginRename(folder.id);
        return;
      }
      // Clicking a folder toggles it, like Finder's disclosure rows.
      if (collapsed.has(folder.id)) collapsed.delete(folder.id);
      else collapsed.add(folder.id);
      storeExpanded();
      renderList();
    };
    rowButton.addEventListener("click", activateRow);
    rowButton.addEventListener("keydown", (event) => {
      // Inner controls (chevron, actions, delete) handle their own keys.
      if (event.target !== rowButton) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activateRow();
    });
    rowButton.addEventListener("dragstart", (event) => {
      drag = { kind: "folder", id: folder.id };
      event.dataTransfer?.setData("text/plain", folder.id);
      event.dataTransfer!.effectAllowed = "move";
    });
    rowButton.addEventListener("dragend", () => {
      drag = null;
    });
    wireDrop(rowButton, { kind: "folder", folder, depth });

    const row = h("li", { class: "sidebar-item" }, rowButton);
    row.style.paddingLeft = `${depth * 0.85}rem`;
    return row;
  }

  function documentRow(document: TreeDocument, depth: number): HTMLLIElement {
    const deleteButton = h(
      "button",
      {
        type: "button",
        class: "sidebar-delete-button",
        title: "Delete document",
        "aria-label": `Delete ${document.title}`,
      },
      createElement(icons.Trash2),
    );
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void handleDelete(document);
    });

    const titleSpan = h(
      "span",
      { class: "sidebar-row-title" },
      renamingId === document.id ? buildRenameInput(document.id, document.title) : document.title,
    );
    // Div with button semantics (see folderRow): inner <button>
    // controls cannot live inside an outer <button>.
    const rowButton = h(
      "div",
      {
        role: "button",
        tabindex: "0",
        class:
          "sidebar-row" + (document.id === selectedId ? " sidebar-row--selected" : ""),
        title: document.title,
        draggable: "true",
        dataset: { documentId: document.id },
      },
      icon(),
      titleSpan,
      deleteButton,
    );
    const activateRow = (): void => {
      if (renamingId === document.id) return;
      if (isRenameClick(document.id)) {
        beginRename(document.id);
        return;
      }
      selectedId = document.id;
      renderList();
      onOpenDocument(document.id);
    };
    rowButton.addEventListener("click", activateRow);
    rowButton.addEventListener("keydown", (event) => {
      // The delete button handles its own keys.
      if (event.target !== rowButton) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activateRow();
    });
    rowButton.addEventListener("dragstart", (event) => {
      drag = { kind: "document", id: document.id };
      event.dataTransfer?.setData("text/plain", document.id);
      event.dataTransfer!.effectAllowed = "move";
    });
    rowButton.addEventListener("dragend", () => {
      drag = null;
    });
    wireDrop(rowButton, { kind: "document", document, depth });

    const row = h("li", { class: "sidebar-item" }, rowButton);
    row.style.paddingLeft = `${depth * 0.85}rem`;
    return row;
  }

  function renderList(): void {
    const treeDocuments: TreeDocument[] = documents.map((document) => ({
      ...document,
      parentId: document.parentId ?? null,
      position: document.position ?? 0,
    }));
    const entries = orderTree(folders, treeDocuments).filter((entry) => {
      // Hide the children of collapsed folders (they stay in the tree,
      // so expansion is instant - no refetch). An entry is visible when
      // none of its ancestors is collapsed.
      let parent: string | null =
        entry.kind === "folder" ? entry.folder.parentId : (entry.document.parentId ?? null);
      while (parent !== null) {
        if (collapsed.has(parent)) return false;
        const owner = folders.find((folder) => folder.id === parent);
        if (owner === undefined) break;
        parent = owner.parentId;
      }
      return true;
    });

    const rows = entries.map((entry) =>
      entry.kind === "folder" ? folderRow(entry.folder, entry.depth) : documentRow(entry.document, entry.depth),
    );
    list.replaceChildren(...rows);
  }

  function folderIcon(collapsedFolder: boolean): Node {
    const node = createElement(collapsedFolder ? icons.Folder : icons.FolderOpen);
    node.classList.add("sidebar-icon");
    return node;
  }

  function icon(): Node {
    const node = createElement(icons.FileText);
    node.classList.add("sidebar-icon");
    return node;
  }

  async function handleDelete(target: DocumentMeta): Promise<void> {
    try {
      await deleteDocument(target.id);
      documents = documents.filter((document) => document.id !== target.id);
      let next: DocumentMeta | null = null;
      if (selectedId === target.id) {
        next = documents[0] ?? null;
        selectedId = next?.id ?? null;
      }
      renderList();
      onDocumentDeleted(next?.id ?? null);
    } catch (error) {
      console.error("[sidebar]", error);
      renderList();
    }
  }

  async function handleFolderDelete(folder: FolderMeta): Promise<void> {
    try {
      await deleteFolder(folder.id);
      folders = folders.filter((entry) => entry.id !== folder.id);
      // The server cascaded; refetch documents to drop the subtree's.
      documents = await listDocuments();
      let next: DocumentMeta | null = null;
      if (selectedId !== null && !documents.some((document) => document.id === selectedId)) {
        next = documents[0] ?? null;
        selectedId = next?.id ?? null;
      }
      renderList();
      onDocumentDeleted(next?.id ?? null);
    } catch (error) {
      console.error("[sidebar]", error);
      renderList();
    }
  }

  async function refresh(): Promise<void> {
    [documents, folders] = await Promise.all([listDocuments(), listFolders()]);
    renderList();
  }

  /** The editor tells the sidebar which document is on screen. */
  function setSelected(id: string | null): void {
    selectedId = id;
    renderList();
  }

  void (async () => {
    try {
      [documents, folders] = await Promise.all([listDocuments(), listFolders()]);
      renderList();
    } catch (error) {
      console.error("[sidebar]", error);
    }
  })();

  return {
    element: root,
    destroy() {
      toggle.remove();
      newHiddenButton.remove();
      document.body.classList.remove("sidebar-resizing", "sidebar-hidden");
    },
  };
}
