export { createEditor } from "./view.ts";
export type { EditorOptions } from "./view.ts";
export { EditorStore } from "./store.ts";
export type { EditorState } from "./store.ts";
export {
  createDocument,
  deleteDocument,
  listDocuments,
  loadDocument,
  saveDocument,
} from "./api.ts";
export { createToolbar } from "./toolbar.ts";
export { FORMAT_ACTIONS, applyFormat } from "./formatting.ts";
export type { FormatAction } from "./formatting.ts";
