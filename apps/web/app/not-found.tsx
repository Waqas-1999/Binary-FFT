import { buttonStyles, Container, EmptyState } from "@repo/ui";
import { Compass } from "lucide-react";
import Link from "next/link";
import { BrandLogo } from "../components/brand-logo";

export default function NotFound() {
  return (
    <Container className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center">
        <BrandLogo />
      </header>
      <main id="main" className="flex flex-1 items-center justify-center pb-16">
        <EmptyState
          icon={<Compass />}
          title="Page not found"
          description="The page you are looking for does not exist or has moved."
          action={
            <Link href="/" className={buttonStyles({ variant: "secondary" })}>
              Go to home
            </Link>
          }
        />
      </main>
    </Container>
  );
}
