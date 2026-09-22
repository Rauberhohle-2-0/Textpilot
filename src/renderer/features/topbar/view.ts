/**
 * The floating top bar: a centered glass pill over the document with
 * the document's vital signs - save state as a colored icon (green =
 * saved, red = working), word count, and reading time.
 *
 * Passive by design, like the title-bar status it replaces: `none`
 * would block text selection underneath, so presses fall through and
 * the bar never steals the caret. State still announces itself through
 * its own live region.
 */
import { createElement, icons } from 'lucide';
import type { Component } from '../../core/component.ts';
import { h } from '../../core/dom.ts';
import type { EditorStore } from '../editor/store.ts';
import { countCharacters, countWords, readingMinutes } from './stats.ts';

export function createTopBar(store: EditorStore): Component<HTMLDivElement> {
  const saveIcon = h('span', { class: 'doc-topbar-save', 'aria-hidden': 'true' });
  const saveLabel = h('span', { class: 'doc-topbar-save-text' }, 'Loading…');
  // Visually hidden: keeps the "All changes saved / Saving…" phrasing
  // for screen readers while the sighted UI shows the icon alone.
  saveLabel.hidden = true;

  const words = h('span', { class: 'doc-topbar-stat' }, '0 words');
  const chars = h('span', { class: 'doc-topbar-stat' }, '0 chars');
  const reading = h('span', { class: 'doc-topbar-stat doc-topbar-stat--dim' }, '0 min');

  const element = h(
    'div',
    {
      class: 'doc-topbar',
      role: 'status',
      'aria-live': 'polite',
    },
    h('span', { class: 'doc-topbar-group' }, saveIcon),
    h('span', { class: 'doc-topbar-separator', 'aria-hidden': 'true' }),
    words,
    h('span', { class: 'doc-topbar-separator', 'aria-hidden': 'true' }),
    chars,
    h('span', { class: 'doc-topbar-separator', 'aria-hidden': 'true' }),
    reading,
    saveLabel,
  );

  const unsubscribe = store.subscribe(({ markdown, saving, loaded, documentId }) => {
    const hasDocument = documentId !== null;
    const wordCount = hasDocument ? countWords(markdown) : 0;
    const charCount = hasDocument ? countCharacters(markdown) : 0;
    const minutes = readingMinutes(wordCount);

    words.textContent = `${wordCount} ${wordCount === 1 ? 'word' : 'words'}`;
    chars.textContent = `${charCount} ${charCount === 1 ? 'char' : 'chars'}`;
    reading.textContent = minutes <= 0 ? '0 min read' : `~${minutes} min read`;

    const status = !loaded
      ? 'Loading…'
      : !hasDocument
        ? 'No document open'
        : saving
          ? 'Saving…'
          : 'All changes saved';
    saveLabel.textContent = status;
    element.setAttribute('aria-label', hasDocument
      ? `${status}. ${words.textContent}, ${chars.textContent}, ${reading.textContent}.`
      : status);

    saveIcon.replaceChildren(saveDot(saving, loaded, hasDocument));
    saveIcon.setAttribute('title', status);
  });

  return {
    element,
    destroy() {
      unsubscribe();
      element.remove();
    },
  };
}

/**
 * Save state as color alone: green check at rest, red spinner while
 * the document is loading or a save is in flight, dimmed hollow dot
 * with no document to save to.
 */
function saveDot(saving: boolean, loaded: boolean, hasDocument: boolean): Node {
  const busy = !loaded || saving;
  const node = createElement(
    !hasDocument ? icons.CircleDashed : busy ? icons.LoaderCircle : icons.Check,
  );
  node.classList.add('doc-topbar-svg');
  node.classList.add(
    !hasDocument
      ? 'doc-topbar-svg--empty'
      : busy
        ? 'doc-topbar-svg--busy'
        : 'doc-topbar-svg--saved',
  );
  if (busy && hasDocument) node.classList.add('doc-topbar-svg--spin');
  return node;
}
