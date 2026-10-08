"use client";

import { Badge, Button, Card } from "@repo/ui";
import { CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { refreshSession, useAuth } from "../lib/auth";
import { linkResultMessages, lookup } from "../lib/oauth";
import { FormAlert } from "./auth/form";

/**
 * Connected sign-in methods. Linking is always started here, by a signed-in person, never inferred
 * from matching emails. The API redirects back with `?google=linked|conflict|failed`.
 */
export function ConnectedAccounts() {
  const auth = useAuth();
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string }>();
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const outcome = lookup(linkResultMessages, new URLSearchParams(window.location.search).get("google"));
    if (!outcome) return;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    queueMicrotask(() => setResult(outcome));
    void refreshSession();
  }, []);

  if (auth.status !== "authenticated") return null;

  async function connect() {
    setConnecting(true);
    setResult(undefined);
    try {
      const { authorizationUrl } = await api<{ authorizationUrl: string }>("/auth/google/link", { method: "POST" });
      window.location.assign(authorizationUrl);
    } catch (error) {
      setResult({ tone: "error", text: errorMessage(error) });
      setConnecting(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-h2">Connected accounts</h2>
        <p className="text-body-small text-text-secondary">Sign-in methods linked to your account.</p>
      </div>
      {result && <FormAlert tone={result.tone}>{result.text}</FormAlert>}
      <div className="flex items-center justify-between gap-4">
        <span className="text-body font-semibold">Google</span>
        {auth.user.googleConnected ? (
          <Badge tone="success" icon={<CircleCheck />}>
            Connected
          </Badge>
        ) : (
          <div className="flex items-center gap-3">
            <Badge>Not connected</Badge>
            <Button variant="secondary" size="md" loading={connecting} onClick={() => void connect()}>
              Connect
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
