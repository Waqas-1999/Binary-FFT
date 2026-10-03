"use client";

import { useEffect } from "react";
import { applyTheme, THEME_CHANGE_EVENT, THEME_STORAGE_KEY, type ThemeConfig } from "./theme.ts";

/**
 * Keeps <html data-theme> in sync after the inline script's first paint: on navigation
 * (route defaults), preference changes (this tab and others) and OS theme changes.
 */
export function ThemeSync({ config, pathname }: { config: ThemeConfig; pathname: string }) {
  useEffect(() => {
    applyTheme(config);
  }, [config, pathname]);

  useEffect(() => {
    const apply = () => applyTheme(config);
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) apply();
    };
    const media = matchMedia("(prefers-color-scheme: dark)");

    window.addEventListener(THEME_CHANGE_EVENT, apply);
    window.addEventListener("storage", onStorage);
    media.addEventListener("change", apply);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, apply);
      window.removeEventListener("storage", onStorage);
      media.removeEventListener("change", apply);
    };
  }, [config]);

  return null;
}
