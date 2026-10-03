import { Card, Container, EmptyState, PageHeader } from "@repo/ui";
import { Wallet } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Wallet" };

export default function WalletPage() {
  return (
    <Container className="flex flex-col gap-6">
      <PageHeader title="Wallet" description="Your balance, deposits and withdrawals in one place." />
      <Card>
        <EmptyState
          icon={<Wallet />}
          title="Your wallet will appear here"
          description="Deposits and withdrawals will be available in a future update."
        />
      </Card>
    </Container>
  );
}
