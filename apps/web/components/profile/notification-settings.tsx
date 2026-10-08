"use client";

import type { NotificationPreferencesResponse } from "@repo/types";
import type { UpdateNotificationPreferencesInput } from "@repo/validation";
import { Badge, Card, Skeleton, Switch } from "@repo/ui";
import { Lock } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { FormAlert } from "../auth/form";

type Category = "account" | "trading" | "promotions";

function Group({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-h3">{title}</h3>
      <p className="mb-2 text-body-small text-text-secondary">{description}</p>
      {children}
    </section>
  );
}

/** Profile > Notifications. The server decides what is allowed; required security email can't be switched off. */
export function NotificationSettings() {
  const auth = useAuth();
  const [prefs, setPrefs] = useState<NotificationPreferencesResponse>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const authenticated = auth.status === "authenticated";

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api<NotificationPreferencesResponse>("/notifications/preferences")
        .then((loaded) => !cancelled && setPrefs(loaded))
        .catch((caught: unknown) => !cancelled && setError(errorMessage(caught)));
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [authenticated]);

  const change = useCallback(async (patch: UpdateNotificationPreferencesInput) => {
    setSaving(true);
    setError(undefined);
    try {
      setPrefs(await api<NotificationPreferencesResponse>("/notifications/preferences", { method: "PATCH", body: patch }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }, []);

  if (auth.status === "unauthenticated") return null;
  if (!prefs) {
    return error ? (
      <FormAlert>{error}</FormAlert>
    ) : (
      <div aria-busy="true" aria-label="Loading notification settings" className="flex flex-col gap-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const telegram = prefs.telegram.connected;
  const row = (category: Category, label: string, description: string) => (
    <>
      <Switch
        label={`${label} by email`}
        description={description}
        checked={prefs.email[category]}
        disabled={saving}
        onCheckedChange={(checked) => void change({ email: { [category]: checked } })}
      />
      {telegram && (
        <Switch
          label={`${label} on Telegram`}
          checked={prefs.telegram[category]}
          disabled={saving}
          onCheckedChange={(checked) => void change({ telegram: { [category]: checked } })}
        />
      )}
    </>
  );

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-h2">Notifications</h2>
        <p className="text-body-small text-text-secondary">Choose which updates you get, and where.</p>
      </div>
      {error && <FormAlert>{error}</FormAlert>}

      <Group title="Security" description="Alerts that protect your account, like new sign-ins and password changes.">
        <Switch
          label="Security emails"
          description={
            <span className="inline-flex items-center gap-1.5">
              <Badge icon={<Lock />}>Required</Badge> Always on, to keep your account safe.
            </span>
          }
          checked
          disabled
          onCheckedChange={() => undefined}
        />
        {telegram && (
          <Switch
            label="Security alerts on Telegram"
            checked={prefs.telegram.security}
            disabled={saving}
            onCheckedChange={(checked) => void change({ telegram: { security: checked } })}
          />
        )}
      </Group>

      <Group title="Account" description="News about your account and service changes.">
        {row("account", "Account updates", "Changes to your account and the service.")}
      </Group>

      <Group title="Trading" description="Results and activity on your trades.">
        {row("trading", "Trade results and activity", "When trades finish and when something needs attention.")}
      </Group>

      <Group title="Promotions" description="Offers and product news. Off unless you turn them on.">
        {row("promotions", "Promotions and offers", "Occasional offers and news.")}
      </Group>

      <p className="border-t border-border pt-5 text-caption text-text-secondary">
        Push notifications aren&apos;t available yet.
        {!telegram && " Connect Telegram in the Profile tab to get notifications there too."}
      </p>
    </Card>
  );
}
