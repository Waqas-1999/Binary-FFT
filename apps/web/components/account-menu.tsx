"use client";

import { buttonStyles, Dropdown, Skeleton, useToast } from "@repo/ui";
import { LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { errorMessage } from "../lib/api";
import { logout, useAuth } from "../lib/auth";
import { appRoutes, authRoutes } from "../lib/routes";

/** Header account control: sign-in link when signed out, account menu when signed in. */
export function AccountMenu() {
  const auth = useAuth();
  const router = useRouter();
  const toast = useToast();

  if (auth.status === "loading") return <Skeleton className="h-11 w-11 rounded-md" />;

  if (auth.status === "unauthenticated") {
    return (
      <Link href={authRoutes.login} className={buttonStyles({ variant: "secondary" })}>
        Sign in
      </Link>
    );
  }

  return (
    <Dropdown
      label="Account"
      iconOnly
      icon={<UserRound />}
      variant="secondary"
      align="end"
      items={[
        { label: `Account ${auth.user.userNumber}`, icon: <UserRound />, onSelect: () => router.push(appRoutes.profile) },
        {
          label: "Log out",
          icon: <LogOut />,
          onSelect: () => {
            logout()
              .then(() => router.push("/"))
              .catch((error: unknown) => toast({ tone: "error", title: "Couldn't log out", description: errorMessage(error) }));
          },
        },
      ]}
    />
  );
}
