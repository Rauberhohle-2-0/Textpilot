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
  /** Where the switch docks - the sidebar hands over both slots: the
   *  footer (panel open) and the collapsed reopen pill (panel hidden).
   *  Required on purpose: a `document` lookup would silently fall back
   *  to <body> whenever the shell is not mounted yet, and that stray
   *  child shifts the whole layout down. */
  ...containers: HTMLElement[]
): Component<HTMLButtonElement> {
  let preference = getStoredTheme();

  // One button per slot; they are clones of one state, so every
  // render() updates all of them and they can never desync.
  const buttons = containers.map((container) => {
    const button = h("button", {
      type: "button",
      class: "theme-switch",
      title: LABEL[preference],
      "aria-label": LABEL[preference],
    }) as HTMLButtonElement;
    button.append(iconFor(preference));
    button.addEventListener("click", cycle);
    container.append(button);
    return button;
  });

  function render(): void {
    for (const button of buttons) {
      button.replaceChildren(iconFor(preference));
      button.title = LABEL[preference];
      button.setAttribute("aria-label", LABEL[preference]);
    }
  }

  function cycle(): void {
    preference = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length]!;
    applyTheme(preference);
    render();
  }

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

  // Docked in every slot the sidebar handed over: the footer's theme
  // circle while the panel is open, the reopen pill's leftmost circle
  // while it is hidden.

  return {
    element: buttons[0]!,
    destroy() {
      window.removeEventListener("storage", onStorage);
      for (const button of buttons) button.remove();
    },
  };
}
