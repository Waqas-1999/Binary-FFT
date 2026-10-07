import { Container } from "@repo/ui";
import type { ReactNode } from "react";
import { BrandLogo } from "../../components/brand-logo";

/** Focused layout for sign-up and sign-in: logo and one task, no navigation. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header>
        <Container className="flex h-16 items-center">
          <BrandLogo />
        </Container>
      </header>
      <main id="main" className="flex flex-1 justify-center px-4 pt-6 pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-sm sm:rounded-lg sm:border sm:border-border sm:bg-surface sm:p-8 sm:shadow-raised">
          {children}
        </div>
      </main>
    </div>
  );
}
