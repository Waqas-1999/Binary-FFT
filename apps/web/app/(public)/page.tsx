import { brand } from "@repo/config";
import { buttonStyles, Container } from "@repo/ui";
import { Gauge, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { appRoutes, publicRoutes } from "../../lib/routes";

const principles = [
  { icon: Sparkles, title: "Simple", text: "A clear screen with only what you need to decide." },
  { icon: Gauge, title: "Fast", text: "Pages load quickly, even on slower connections." },
  { icon: ShieldCheck, title: "Clear", text: "Plain language, with no hidden steps." },
];

export default function HomePage() {
  return (
    <Container className="flex flex-col gap-16">
      <section className="flex max-w-2xl flex-col gap-6">
        <h1 className="text-display">Fixed-time trading, made simple.</h1>
        <p className="text-body text-text-secondary sm:text-h2 sm:font-normal">
          {brand.name} is built for beginners from the first screen to the last. We are getting things ready.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href={appRoutes.trade} className={buttonStyles({ size: "lg" })}>
            Open the app
          </Link>
          <Link href={publicRoutes.faq} className={buttonStyles({ variant: "secondary", size: "lg" })}>
            Read the FAQ
          </Link>
        </div>
      </section>

      <ul className="grid gap-6 sm:grid-cols-3">
        {principles.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex flex-col gap-2">
            <Icon aria-hidden="true" className="size-6 text-brand" />
            <h2 className="text-h3">{title}</h2>
            <p className="text-body-small text-text-secondary">{text}</p>
          </li>
        ))}
      </ul>
    </Container>
  );
}
