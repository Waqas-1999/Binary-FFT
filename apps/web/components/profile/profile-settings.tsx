"use client";

import type { OAuthReauthResult, ProfileResponse } from "@repo/types";
import { buttonStyles, EmptyState, Skeleton } from "@repo/ui";
import { UserRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { lookup } from "../../lib/oauth";
import { authRoutes } from "../../lib/routes";
import { FormAlert } from "../auth/form";
import { ConnectedAccounts } from "../connected-accounts";
import { MobileCard } from "./mobile-card";
import { ProfileDetailsCard } from "./profile-details-card";
import { TelegramCard } from "./telegram-card";

const reauthMessages: Record<OAuthReauthResult, { tone: "success" | "error"; text: string }> = {
  ok: { tone: "success", text: "Thanks, you're confirmed. You can now finish what you were doing." },
  failed: { tone: "error", text: "We couldn't confirm it's you. Please try again." },
};

/** Profile > Profile. Everything shown comes from `GET /profile`, which is always about the signed-in user. */
export function ProfileSettings() {
  const auth = useAuth();
  const [profile, setProfile] = useState<ProfileResponse>();
  const [error, setError] = useState<string>();
  const [reauth, setReauth] = useState<{ tone: "success" | "error"; text: string }>();
  const authenticated = auth.status === "authenticated";

  const load = useCallback(async () => {
    try {
      setProfile(await api<ProfileResponse>("/profile"));
      setError(undefined);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  // Deferred so the fetch's state updates never happen synchronously inside the effect.
  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [authenticated, load]);

  // Google sends people back with ?reauth=ok|failed after they confirm it's them.
  useEffect(() => {
    const outcome = lookup(reauthMessages, new URLSearchParams(window.location.search).get("reauth"));
    if (!outcome) return;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    queueMicrotask(() => setReauth(outcome));
  }, []);

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

  if (!profile) {
    return error ? (
      <FormAlert>{error}</FormAlert>
    ) : (
      <div aria-busy="true" aria-label="Loading profile" className="flex flex-col gap-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-56 max-w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {reauth && <FormAlert tone={reauth.tone}>{reauth.text}</FormAlert>}
      <ProfileDetailsCard key={`${profile.displayName}|${profile.settings.timeZone}`} profile={profile} onChanged={load} />
      <MobileCard profile={profile} onChanged={load} />
      <ConnectedAccounts />
      <TelegramCard profile={profile} onChanged={load} />
    </div>
  );
}
