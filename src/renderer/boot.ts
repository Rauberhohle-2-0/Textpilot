/**
 * Composition root of the UI.
 *
 * Knows the features and mounts them. Anything cross-cutting - here the
 * shared status line - is wired here rather than hidden inside a feature,
 * so features stay independent and the shell stays boring.
 */
import type { Component } from './core/index.ts'
import { h } from './core/dom.ts'
import { createEditor } from './features/editor/index.ts'
import { createSidebar } from './features/sidebar/index.ts'
import { createThemeSwitch, initTheme } from './features/theme/index.ts'
import './styles/main.css'

export function boot(root: HTMLElement = document.body): void {
  // Pin the stored appearance before first paint so a saved dark mode
  // never flashes light (system = no attribute, CSS media decides).
  initTheme()

  const features: Component[] = []

  // Native title-bar strip: the band at the top of the window that the
  // runtime moves the window from, and maximises on double-click - but
  // only where the page leaves it empty. The editor below is one big
  // contenteditable surface, so without this strip every pixel of the
  // band lands in editable text and the runtime never sees an
  // empty-space press (no drag, no double-click zoom).
  //
  // The sidebar spans the full window height - traffic lights floating
  // over it, macOS source-list style - so the strip only sits over the
  // editor column. The sidebar carries its own drag band inside.
  //
  // The band is not inert: the save status docks at its right end, and
  // is `pointer-events: none` so presses still reach the band underneath
  // it. That keeps the drag region whole while giving a piece of document
  // state a home in window chrome instead of a footer across the bottom
  // edge of the window.
  const shell = h('div', {
    class: 'flex flex-row h-screen w-screen overflow-hidden',
  })
  // A `div`, not a `header`: the band is window chrome, and a header here
  // would be a `banner` landmark wrapping nothing but the save status -
  // which announces itself through its own live region.
  const titleBar = h('div', {
    class: 'titlebar-spacer',
    'data-vantail-drag': '',
  })
  const editorColumn = h('div', { class: 'flex-1 min-w-0 flex flex-col editor-column' })

  const editor = createEditor({ statusSlot: titleBar })
  features.push(editor)
  const sidebar = createSidebar({
    onOpenDocument(id) {
      void editor.openDocument(id)
    },
    onDocumentDeleted(nextId) {
      if (nextId !== null) {
        void editor.openDocument(nextId)
        return
      }
      // The last document is gone: give the editor a blank canvas so
      // a deleted document's text cannot linger on screen.
      editor.showBlank()
    },
  })
  features.push(sidebar)

  editorColumn.append(titleBar, editor.element)
  shell.append(sidebar.element, editorColumn)
  root.append(shell)

  // Mounted only once the shell is in the document: the switch docks
  // into the slots the sidebar hands it (footer + collapsed reopen
  // pill), so it rides with the panel toggle in both states. Created
  // any earlier, its mount points are not in the document yet and the
  // buttons land detached.
  const themeSwitch = createThemeSwitch(sidebar.themeSlot, sidebar.themeSlotHidden)
  features.push(themeSwitch)

  // Native window state: while the window is in the background macOS
  // gives up its accent selection and grays the picked row, so a
  // blurred window never looks like the one you are working in. One
  // class on <body> carries that, the CSS does the rest.
  const syncWindowFocus = (): void => {
    document.body.classList.toggle('window-inactive', !document.hasFocus())
  }
  window.addEventListener('focus', syncWindowFocus)
  window.addEventListener('blur', syncWindowFocus)
  syncWindowFocus()

  window.addEventListener('beforeunload', () => {
    window.removeEventListener('focus', syncWindowFocus)
    window.removeEventListener('blur', syncWindowFocus)
    for (const feature of features) feature.destroy?.()
  })
}
