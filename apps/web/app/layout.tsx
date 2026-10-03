import { brand } from "@repo/config";
import { themeScript } from "@repo/ui";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppThemeSync } from "../components/app-theme-sync";
import { themeConfig } from "../lib/routes";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: brand.name, template: `%s · ${brand.name}` },
  applicationName: brand.name,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The theme script sets data-theme before hydration, so the attribute legitimately differs.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript(themeConfig) }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only z-50 rounded-sm bg-surface-elevated px-4 py-3 font-semibold shadow-overlay focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <AppThemeSync />
        {children}
      </body>
    </html>
  );
}
