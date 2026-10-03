"use client";

import { ThemeSync } from "@repo/ui";
import { usePathname } from "next/navigation";
import { themeConfig } from "../lib/routes";

export function AppThemeSync() {
  return <ThemeSync config={themeConfig} pathname={usePathname()} />;
}
