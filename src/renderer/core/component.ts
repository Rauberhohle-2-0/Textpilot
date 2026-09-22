/**
 * The component contract.
 *
 * A component is a factory returning `{ element, destroy? }`. Features
 * compose components; the shell keeps the list and destroys them on
 * unload, so timers and listeners never outlive the window that opened
 * them.
 */
export interface Component<T extends HTMLElement = HTMLElement> {
  readonly element: T;
  destroy?(): void;
}
