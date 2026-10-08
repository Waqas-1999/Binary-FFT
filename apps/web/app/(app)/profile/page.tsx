import { Card, Container, PageHeader, Tabs, ThemeSelector } from "@repo/ui";
import type { Metadata } from "next";
import { NotificationSettings } from "../../../components/profile/notification-settings";
import { ProfileSettings } from "../../../components/profile/profile-settings";
import { SecuritySettings } from "../../../components/security/security-settings";

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
            content: <ProfileSettings />,
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
            content: <SecuritySettings />,
          },
          {
            value: "notifications",
            label: "Notifications",
            content: <NotificationSettings />,
          },
        ]}
      />
    </Container>
  );
}
