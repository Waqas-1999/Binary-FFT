import { Container, EmptyState, PageHeader } from "@repo/ui";
import { Newspaper } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Blog" };

export default function BlogPage() {
  return (
    <Container className="flex max-w-3xl flex-col gap-8">
      <PageHeader title="Blog" description="Guides and news to help you trade with confidence." />
      <EmptyState icon={<Newspaper />} title="No articles yet" description="Articles will appear here." />
    </Container>
  );
}
