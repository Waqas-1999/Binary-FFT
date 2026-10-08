"use client";

import type { OAuthReauthResult, SecurityStatus } from "@repo/types";
import { Skeleton } from "@repo/ui";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { lookup } from "../../lib/oauth";
import { FormAlert } from "../auth/form";
import { PasswordCard } from "./password-card";
import { SessionsCard } from "./sessions-card";
import { TwoFactorCard } from "./two-factor-card";

const reauthMessages: Record<OAuthReauthResult, { tone: "success" | "error"; text: string }> = {
  ok: { tone: "success", text: "Thanks, you're confirmed. You can now finish what you were doing." },
  failed: { tone: "error", text: "We couldn't confirm it's you. Please try again." },
};

/** Profile > Security. All state-changing checks happen on the server; this only asks and displays. */
export function SecuritySettings() {
  const auth = useAuth();
  const [status, setStatus] = useState<SecurityStatus>();
  const [error, setError] = useState<string>();
  const [reauth, setReauth] = useState<{ tone: "success" | "error"; text: string }>();
  const [version, setVersion] = useState(0);
  const authenticated = auth.status === "authenticated";

  const load = useCallback(async () => {
    try {
      setStatus(await api<SecurityStatus>("/auth/security"));
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
  }, [authenticated, load, version]);

  // Google sends people back with ?reauth=ok|failed after they confirm it's them.
  useEffect(() => {
    const outcome = lookup(reauthMessages, new URLSearchParams(window.location.search).get("reauth"));
    if (!outcome) return;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    queueMicrotask(() => setReauth(outcome));
  }, []);

  const changed = useCallback(() => setVersion((current) => current + 1), []);

  if (auth.status === "unauthenticated") return null;
  if (!status) {
    return error ? (
      <FormAlert>{error}</FormAlert>
    ) : (
      <div aria-busy="true" aria-label="Loading security settings" className="flex flex-col gap-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {reauth && <FormAlert tone={reauth.tone}>{reauth.text}</FormAlert>}
      <TwoFactorCard status={status} onChanged={changed} />
      <SessionsCard version={version} onChanged={changed} />
      <PasswordCard status={status} onChanged={changed} />
    </div>
  );
}
