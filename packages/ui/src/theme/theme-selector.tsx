"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  readThemePreference,
  setThemePreference,
  THEME_CHANGE_EVENT,
  type ThemePreference,
} from "./theme.ts";

const options: Array<{ value: ThemePreference; label: string; icon: LucideIcon }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

function subscribe(onChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Light / Dark / System choice. With no stored preference, the current page's resolved theme is
 * shown as selected so the control always reflects what the user sees.
 */
export function ThemeSelector({ label = "Theme" }: { label?: string }) {
  const value = useSyncExternalStore<ThemePreference | null>(
    subscribe,
    () => readThemePreference() ?? (document.documentElement.dataset.theme as ThemePreference | undefined) ?? null,
    () => null,
  );

  return (
    <fieldset>
      <legend className="mb-3 text-body-small font-medium text-text-secondary">{label}</legend>
      <div className="grid grid-cols-3 gap-1 rounded-md border border-border bg-surface-muted p-1">
        {options.map(({ value: option, label: optionLabel, icon: Icon }) => (
          <label
            key={option}
            className="transition-control flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-sm text-body-small font-medium text-text-secondary hover:text-text-primary has-checked:bg-surface-elevated has-checked:text-text-primary has-checked:shadow-raised has-focus-visible:outline-2 has-focus-visible:outline-brand"
          >
            <input
              type="radio"
              name="theme"
              value={option}
              checked={value === option}
              onChange={() => setThemePreference(option)}
              className="sr-only"
            />
            <Icon aria-hidden="true" className="size-4" />
            {optionLabel}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
