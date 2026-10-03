import { act, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { setSystemDark } from "../test-setup.ts";
import { applyTheme, themeScript, type ThemeConfig } from "./theme.ts";
import { ThemeSelector } from "./theme-selector.tsx";
import { ThemeSync } from "./theme-sync.tsx";

const config: ThemeConfig = { fallback: "light", routeDefaults: [["/trade", "dark"]] };
const theme = () => document.documentElement.dataset.theme;

function visit(path: string) {
  window.history.replaceState(null, "", path);
}

afterEach(() => {
  visit("/");
  setSystemDark(false);
});

describe("applyTheme", () => {
  it("uses route defaults when there is no stored preference", () => {
    visit("/trade/anything");
    expect(applyTheme(config)).toBe("dark");
    expect(theme()).toBe("dark");

    visit("/trader"); // prefix must match a whole path segment
    expect(applyTheme(config)).toBe("light");
  });

  it("lets a stored preference override route defaults", () => {
    visit("/trade");
    localStorage.setItem("theme", "light");
    expect(applyTheme(config)).toBe("light");
  });

  it("resolves system from the OS setting", () => {
    localStorage.setItem("theme", "system");
    setSystemDark(true);
    expect(applyTheme(config)).toBe("dark");
    setSystemDark(false);
    expect(applyTheme(config)).toBe("light");
  });

  it("ignores invalid stored values", () => {
    localStorage.setItem("theme", "purple");
    expect(applyTheme(config)).toBe("light");
  });
});

describe("themeScript", () => {
  it("is a self-contained script that applies the theme before React loads", () => {
    visit("/trade");
    new Function(themeScript(config))();
    expect(theme()).toBe("dark");
  });
});

describe("ThemeSelector", () => {
  it("persists the choice and applies it immediately", async () => {
    const user = userEvent.setup();
    visit("/trade");
    applyTheme(config);
    render(
      <>
        <ThemeSync config={config} pathname="/trade" />
        <ThemeSelector />
      </>,
    );

    // Without a stored preference, the theme currently shown is selected.
    expect((screen.getByRole("radio", { name: "Dark" }) as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(localStorage.getItem("theme")).toBe("light");
    expect(theme()).toBe("light");
    expect((screen.getByRole("radio", { name: "Light" }) as HTMLInputElement).checked).toBe(true);

    await act(async () => {
      await user.keyboard("{ArrowRight}");
    });
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(theme()).toBe("dark");
  });
});
