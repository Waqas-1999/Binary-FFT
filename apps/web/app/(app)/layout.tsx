import { Container, OfflineBanner, ToastProvider } from "@repo/ui";
import type { ReactNode } from "react";
import { BottomNav, TopNav } from "../../components/app-nav";
import { BrandLogo } from "../../components/brand-logo";
import { appRoutes } from "../../lib/routes";

/** Customer app shell: header (with inline nav from md), content, and bottom nav on mobile. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-background">
          <OfflineBanner />
          <Container className="flex h-14 items-center justify-between gap-4 md:h-16">
            <BrandLogo href={appRoutes.trade} />
            <TopNav />
          </Container>
        </header>
        {/* Bottom padding keeps content clear of the fixed mobile navigation. */}
        <main id="main" className="flex-1 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pt-10 md:pb-16">
          {children}
        </main>
        <BottomNav />
      </div>
    </ToastProvider>
  );
}
