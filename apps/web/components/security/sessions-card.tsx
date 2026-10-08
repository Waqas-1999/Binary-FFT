"use client";

import type { SessionInfo, SessionsResponse } from "@repo/types";
import { Badge, Button, Card, Skeleton } from "@repo/ui";
import { Laptop, Monitor } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { FormAlert } from "../auth/form";

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Where the person is signed in. Revoking happens on the server, so a signed-out device stops working at once. */
export function SessionsCard({ version, onChanged }: { version: number; onChanged: () => void }) {
  const [sessions, setSessions] = useState<SessionInfo[]>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState<string>();

  const load = useCallback(async () => {
    try {
      const result = await api<SessionsResponse>("/auth/sessions");
      setSessions(result.sessions);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  // Deferred so the fetch's state updates never happen synchronously inside the effect.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, version]);

  async function revoke(session: SessionInfo) {
    setBusy(session.id);
    setError(undefined);
    try {
      await api(`/auth/sessions/${session.id}/revoke`, { method: "POST" });
      setNotice("That device has been signed out.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(undefined);
      void load();
    }
  }

  async function revokeOthers() {
    setBusy("others");
    setError(undefined);
    try {
      await api("/auth/sessions/revoke-others", { method: "POST" });
      setNotice("All your other devices have been signed out.");
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(undefined);
    }
  }

  const others = sessions?.filter((session) => !session.current).length ?? 0;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-h2">Active sessions</h2>
          <p className="text-body-small text-text-secondary">Devices where you&apos;re signed in. Sign out any you don&apos;t recognise.</p>
        </div>
        <Button variant="secondary" disabled={others === 0} loading={busy === "others"} onClick={() => void revokeOthers()}>
          Sign out other devices
        </Button>
      </div>

      {error && <FormAlert>{error}</FormAlert>}
      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {!sessions ? (
        <div aria-busy="true" aria-label="Loading sessions" className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {sessions.map((session) => {
            const Icon = /iOS|Android/.test(session.device.os) ? Monitor : Laptop;
            return (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-start gap-3">
                  <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-text-secondary" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 font-semibold">
                      {session.device.browser} on {session.device.os}
                      {session.current && <Badge tone="brand">This device</Badge>}
                    </span>
                    <span className="text-body-small text-text-secondary">
                      Last active <time dateTime={session.lastActiveAt}>{formatWhen(session.lastActiveAt)}</time>
                      {session.ipAddress ? ` · ${session.ipAddress}` : ""}
                    </span>
                    <span className="text-caption text-text-muted">
                      Signed in <time dateTime={session.createdAt}>{formatWhen(session.createdAt)}</time>
                    </span>
                  </div>
                </div>
                {!session.current && (
                  <Button variant="ghost" loading={busy === session.id} onClick={() => void revoke(session)}>
                    Sign out
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
