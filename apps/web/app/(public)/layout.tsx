import { brand } from "@repo/config";
import { buttonStyles, Container } from "@repo/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLogo } from "../../components/brand-logo";
import { appRoutes, publicRoutes } from "../../lib/routes";

const links = [
  { href: publicRoutes.blog, label: "Blog" },
  { href: publicRoutes.faq, label: "FAQ" },
];

const linkClasses =
  "transition-control focus-ring flex min-h-11 items-center rounded-sm px-3 text-body-small font-medium text-text-secondary hover:text-text-primary";

/** Public website shell (home, blog, FAQ). Defaults to the light theme. */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border">
        <Container className="flex h-16 items-center justify-between gap-2">
          <BrandLogo />
          <div className="flex items-center gap-1">
            <nav aria-label="Site" className="hidden sm:block">
              <ul className="flex items-center">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={linkClasses}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <Link href={appRoutes.trade} className={buttonStyles({ variant: "primary" })}>
              Open app
            </Link>
          </div>
        </Container>
      </header>

      <main id="main" className="flex-1 py-10 sm:py-16">
        {children}
      </main>

      <footer className="border-t border-border py-6">
        <Container className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-caption text-text-secondary">
            © {new Date().getFullYear()} {brand.name}
          </p>
          <nav aria-label="Footer">
            <ul className="-mx-3 flex">
              {links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={linkClasses}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </Container>
      </footer>
    </div>
  );
}
