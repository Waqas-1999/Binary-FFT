import { Card, Container, EmptyState, PageHeader } from "@repo/ui";
import { History } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  return (
    <Container className="flex flex-col gap-6">
      <PageHeader title="Activity" description="Your trades and account events, newest first." />
      <Card>
        <EmptyState
          icon={<History />}
          title="No activity yet"
          description="Your activity will appear here once trading is available."
        />
      </Card>
    </Container>
  );
}
