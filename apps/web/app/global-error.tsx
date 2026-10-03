"use client";

import { themeScript } from "@repo/ui";
import { RouteError } from "../components/route-error";
import { themeConfig } from "../lib/routes";
import "./globals.css";

/** Last-resort boundary for errors in the root layout. Replaces the whole document. */
export default function GlobalError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript(themeConfig) }} />
      </head>
      <body className="flex min-h-dvh items-center">
        <main className="w-full">
          <RouteError {...props} />
        </main>
      </body>
    </html>
  );
}
