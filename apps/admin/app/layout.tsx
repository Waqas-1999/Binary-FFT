import { brand } from "@repo/config";
import { Container, themeScript } from "@repo/ui";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const title = `${brand.name} Admin`;

export const metadata: Metadata = {
  title: { default: title, template: `%s · ${title}` },
  applicationName: title,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript({ fallback: "system" }) }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <header className="border-b border-border">
          <Container className="flex h-16 items-center gap-2">
            <span className="text-h3 font-bold tracking-tight">{brand.shortName}</span>
            <span className="text-body-small text-text-secondary">Admin</span>
          </Container>
        </header>
        <main className="flex-1 py-10">{children}</main>
      </body>
    </html>
  );
}
