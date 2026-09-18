/**
 * The theme switch: light / dark / system, macOS-style.
 *
 * Follows the system appearance by default (`prefers-color-scheme`,
 * pure CSS) and lets the user override it from a small button docked
 * in the title-bar controls over the editor column, next to the panel
 * toggle. One button cycles System → Light → Dark; the icon shows
 * what is active (SunMoon for system, Sun for light, Moon for dark).
 * The choice persists in localStorage and applies via `data-theme`
 * on <html> before first paint, so a stored dark mode never flashes
 * light.
 */
import { createElement, icons } from "lucide";
import type { Component } from "../../core/component.ts";
import { h } from "../../core/dom.ts";

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "textpilot.theme";

const ORDER: ThemePreference[] = ["system", "light", "dark"];

const LABEL: Record<ThemePreference, string> = {
  system: "Theme: System (follows macOS)",
  light: "Theme: Light",
  dark: "Theme: Dark",
};

/** Read the stored preference; anything unknown falls back to system. */
export function getStoredTheme(): ThemePreference {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

/**
 * Apply a preference: set `data-theme` for an explicit override, drop
 * the attribute for system so the CSS media query takes over.
 */
export function applyTheme(preference: ThemePreference): void {
  if (preference === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.dataset.theme = preference;
  }
  window.localStorage.setItem(STORAGE_KEY, preference);
}

/** Apply the stored preference. Called from boot before first paint. */
export function initTheme(): ThemePreference {
  const preference = getStoredTheme();
  applyTheme(preference);
  return preference;
}

function iconFor(preference: ThemePreference): Node {
  const icon = preference === "light"
    ? icons.Sun
    : preference === "dark"
      ? icons.Moon
      : icons.SunMoon;
  return createElement(icon);
}

export function createThemeSwitch(
  /** Where the switch docks - the sidebar hands over its title-bar
   *  slot. Required on purpose: a `document` lookup would silently fall
   *  back to <body> whenever the shell is not mounted yet, and that
   *  stray child shifts the whole layout down. */
  container: HTMLElement,
): Component<HTMLButtonElement> {
  let preference = getStoredTheme();

  const button = h("button", {
    type: "button",
    class: "theme-switch",
    title: LABEL[preference],
    "aria-label": LABEL[preference],
  }) as HTMLButtonElement;
  button.append(iconFor(preference));

  function render(): void {
    button.replaceChildren(iconFor(preference));
    button.title = LABEL[preference];
    button.setAttribute("aria-label", LABEL[preference]);
  }

  button.addEventListener("click", () => {
    preference = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length]!;
    applyTheme(preference);
    render();
  });

  // A second window/tab changing the preference follows along.
  function onStorage(event: StorageEvent): void {
    if (event.key !== STORAGE_KEY) return;
    const next = getStoredTheme();
    if (next === preference) return;
    preference = next;
    // Apply without re-storing: the originating tab already did.
    if (preference === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.dataset.theme = preference;
    }
    render();
  }
  window.addEventListener("storage", onStorage);

  // Docked in the title-bar controls next to the panel toggle, so it
  // is always visible, rail open or not.
  container.append(button);

  return {
    element: button,
    destroy() {
      window.removeEventListener("storage", onStorage);
      button.remove();
    },
  };
}
