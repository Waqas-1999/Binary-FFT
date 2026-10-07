import { Card, Container, EmptyState, PageHeader, Tabs, ThemeSelector } from "@repo/ui";
import { Bell, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { AccountDetails } from "../../../components/account-details";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <Container className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Profile" description="Manage your account and preferences." />
      <Tabs
        label="Profile sections"
        items={[
          {
            value: "profile",
            label: "Profile",
            content: (
              <Card>
                <AccountDetails />
              </Card>
            ),
          },
          {
            value: "appearance",
            label: "Appearance",
            content: (
              <Card className="flex flex-col gap-2">
                <h2 className="text-h2">Appearance</h2>
                <p className="mb-4 text-body-small text-text-secondary">
                  Choose how the app looks. System follows your device setting.
                </p>
                <ThemeSelector />
              </Card>
            ),
          },
          {
            value: "security",
            label: "Security",
            content: (
              <Card>
                <EmptyState
                  icon={<ShieldCheck />}
                  title="Security settings"
                  description="Password and sign-in protection will be managed here."
                />
              </Card>
            ),
          },
          {
            value: "notifications",
            label: "Notifications",
            content: (
              <Card>
                <EmptyState
                  icon={<Bell />}
                  title="Notification preferences"
                  description="Choose which updates you receive. Coming in a future update."
                />
              </Card>
            ),
          },
        ]}
      />
    </Container>
  );
}
