export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface ThemeConfig {
  /** Theme used when the user has no stored preference and no route default matches. */
  fallback: ThemePreference;
  /** Path prefix → default theme, e.g. dark for the trading app and light for public pages. */
  routeDefaults?: Array<[prefix: string, theme: ThemePreference]>;
}

export const THEME_STORAGE_KEY = "theme";
export const THEME_CHANGE_EVENT = "themechange";
export const themePreferences: readonly ThemePreference[] = ["light", "dark", "system"];

/**
 * Resolves and applies the theme to <html>. Runs both as the blocking inline script (to avoid a
 * flash of the wrong theme) and at runtime, so it must stay self-contained: no imports, no
 * references to outer variables.
 */
export function applyTheme(config: ThemeConfig): ResolvedTheme {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem("theme");
  } catch {
    // Storage can be blocked (privacy mode); fall back to defaults.
  }

  let preference: ThemePreference | null =
    stored === "light" || stored === "dark" || stored === "system" ? stored : null;
  if (!preference) {
    const path = location.pathname;
    const match = (config.routeDefaults ?? []).find(([prefix]) => path === prefix || path.startsWith(prefix + "/"));
    preference = match ? match[1] : config.fallback;
  }

  const resolved: ResolvedTheme =
    preference === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : preference;

  const root = document.documentElement;
  if (root.dataset.theme !== resolved) {
    root.dataset.themeSwitching = "";
    root.dataset.theme = resolved;
    // Re-enable transitions after the new colors have painted.
    requestAnimationFrame(() => requestAnimationFrame(() => delete root.dataset.themeSwitching));
  }
  return resolved;
}

/** Inline script for <head>. Applies the theme before first paint. */
export function themeScript(config: ThemeConfig): string {
  return `(${applyTheme.toString()})(${JSON.stringify(config)})`;
}

export function readThemePreference(): ThemePreference | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return themePreferences.find((theme) => theme === stored) ?? null;
  } catch {
    return null;
  }
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage is blocked; the preference cannot be saved.
  }
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: preference }));
}
