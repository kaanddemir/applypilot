// Light / Dark / System theme. index.html runs an inline copy of resolveTheme()
// before first paint (keep the two in sync); this module owns changes after load.
import { store, LS } from "./store.js";
import { notify } from "./notifications.js";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_OPTIONS: readonly ThemePreference[] = ["light", "dark", "system"];
let activePreference: ThemePreference | null = null;

// Only an explicit Light or Dark choice is stored; no stored value means System.
export function parseThemePreference(raw: string | null): ThemePreference {
  return raw === "light" || raw === "dark" ? raw : "system";
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === "system") return systemDark ? "dark" : "light";
  return preference;
}

const darkQuery = (): MediaQueryList | null =>
  typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function themePreference(): ThemePreference {
  return activePreference ?? parseThemePreference(store.get(LS.theme, null));
}

export function applyTheme(preference: ThemePreference = themePreference()): ResolvedTheme {
  // The applied choice remains authoritative in this tab even if storage fails.
  activePreference = preference;
  const resolved = resolveTheme(preference, !!darkQuery()?.matches);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themePreference = preference;
  return resolved;
}

export function setThemePreference(preference: ThemePreference): ResolvedTheme {
  const saved = preference === "system" ? store.remove(LS.theme) : store.set(LS.theme, preference);
  if (!saved) notify.error("Theme preference could not be saved.", { detail: "The selected theme will only remain active in this tab.", key: "theme-save-failed" });
  return applyTheme(preference);
}

// Follows OS changes only while System is selected; `onChange` lets the UI
// refresh the control that shows the resolved theme.
export function watchSystemTheme(onChange: () => void): void {
  darkQuery()?.addEventListener("change", () => {
    if (themePreference() !== "system") return;
    applyTheme("system");
    onChange();
  });
}
