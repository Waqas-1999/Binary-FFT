"use client";

import type { ProfileResponse, TelegramLinkResponse } from "@repo/types";
import { Badge, Button, buttonStyles, Card, Dialog } from "@repo/ui";
import { CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { FormAlert } from "../auth/form";
import { useReauthGate } from "./reauth";

const POLL_MS = 4000;

/**
 * Telegram is a place to receive notifications, never a way to sign in. Connecting opens the bot with a
 * one-time link; the server learns about it from Telegram and this card just waits for the profile to say
 * "connected".
 */
export function TelegramCard({ profile, onChanged }: { profile: ProfileResponse; onChanged: () => void }) {
  const { connected, available } = profile.telegram;
  const gate = useReauthGate();
  const [link, setLink] = useState<{ url: string; until: number }>();
  const [busy, setBusy] = useState<"link" | "unlink">();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // While waiting for the person to press Start in Telegram, keep checking the profile.
  const waiting = link !== undefined && !connected;
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => {
      if (Date.now() > link.until) setLink(undefined);
      else onChanged();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting, link, onChanged]);

  useEffect(() => {
    if (!connected || !link) return;
    const timer = window.setTimeout(() => {
      setLink(undefined);
      setNotice("Telegram is connected.");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [connected, link]);

  async function startLink() {
    setBusy("link");
    setError(undefined);
    setNotice(undefined);
    await gate.run(
      async () => {
        const result = await api<TelegramLinkResponse>("/profile/telegram/link", { method: "POST" });
        setLink({ url: result.url, until: Date.now() + result.expiresInSeconds * 1000 });
      },
      (caught) => setError(errorMessage(caught)),
    );
    setBusy(undefined);
  }

  async function disconnect() {
    setConfirmDisconnect(false);
    setBusy("unlink");
    setError(undefined);
    await gate.run(
      async () => {
        await api("/profile/telegram", { method: "DELETE" });
        setNotice("Telegram was disconnected.");
        onChanged();
      },
      (caught) => setError(errorMessage(caught)),
    );
    setBusy(undefined);
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-h2">Telegram</h2>
          <p className="text-body-small text-text-secondary">Get notifications in Telegram. It isn&apos;t used to sign in.</p>
        </div>
        {connected ? (
          <Badge tone="success" icon={<CircleCheck />}>
            Connected
          </Badge>
        ) : (
          <Badge>Not connected</Badge>
        )}
      </div>

      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {error && <FormAlert>{error}</FormAlert>}

      {connected ? (
        <div>
          <Button variant="secondary" loading={busy === "unlink"} onClick={() => setConfirmDisconnect(true)}>
            Disconnect
          </Button>
        </div>
      ) : !available ? (
        <p className="text-body-small text-text-secondary">Telegram isn&apos;t available right now.</p>
      ) : waiting ? (
        <div className="flex flex-col gap-4">
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-body-small text-text-secondary">
            <li>Open Telegram with the button below.</li>
            <li>Press Start in the chat.</li>
            <li>Come back here. This page updates by itself.</li>
          </ol>
          <div className="flex flex-col gap-2 sm:flex-row">
            <a href={link.url} target="_blank" rel="noopener noreferrer" className={buttonStyles()}>
              Open Telegram
            </a>
            <Button variant="secondary" onClick={onChanged}>
              Check connection
            </Button>
            <Button variant="ghost" onClick={() => setLink(undefined)}>
              Cancel
            </Button>
          </div>
          <p className="text-caption text-text-secondary">The link works once and expires in 10 minutes. Didn&apos;t work? Cancel and try again.</p>
        </div>
      ) : (
        <div>
          <Button variant="secondary" loading={busy === "link"} onClick={() => void startLink()}>
            Connect Telegram
          </Button>
        </div>
      )}

      <Dialog
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        title="Disconnect Telegram?"
        description="You'll stop getting notifications there. Signing in isn't affected."
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setConfirmDisconnect(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void disconnect()}>
              Disconnect
            </Button>
          </div>
        }
      />
      {gate.dialog}
    </Card>
  );
}
