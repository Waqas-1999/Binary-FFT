"use client";

import { Badge, buttonStyles, EmptyState, Skeleton } from "@repo/ui";
import { CircleCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useAuth } from "../lib/auth";
import { authRoutes } from "../lib/routes";

export function AccountDetails() {
  const auth = useAuth();

  if (auth.status === "loading") {
    return (
      <div aria-busy="true" aria-label="Loading account" className="flex flex-col gap-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-56 max-w-full" />
      </div>
    );
  }

  if (auth.status === "unauthenticated") {
    return (
      <EmptyState
        icon={<UserRound />}
        title="You're not signed in"
        description="Sign in to see your account details."
        action={
          <Link href={`${authRoutes.login}?next=/profile`} className={buttonStyles()}>
            Sign in
          </Link>
        }
      />
    );
  }

  return (
    <dl className="flex flex-col divide-y divide-border">
      <div className="flex flex-col gap-1 pb-4">
        <dt className="text-caption text-text-secondary">User ID</dt>
        <dd className="text-h3 tabular-nums">{auth.user.userNumber}</dd>
      </div>
      <div className="flex flex-col gap-1 pt-4">
        <dt className="text-caption text-text-secondary">Email</dt>
        <dd className="flex flex-wrap items-center gap-2 text-body break-all">
          {auth.user.email}
          {auth.user.emailVerified && (
            <Badge tone="success" icon={<CircleCheck />}>
              Verified
            </Badge>
          )}
        </dd>
      </div>
    </dl>
  );
}
