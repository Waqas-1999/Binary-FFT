import { Container, EmptyState, PageHeader } from "@repo/ui";
import { CircleHelp } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "FAQ" };

export default function FaqPage() {
  return (
    <Container className="flex max-w-3xl flex-col gap-8">
      <PageHeader title="Frequently asked questions" description="Quick answers to common questions." />
      <EmptyState icon={<CircleHelp />} title="No questions yet" description="Answers will appear here." />
    </Container>
  );
}
