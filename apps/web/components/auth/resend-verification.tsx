"use client";

import { Button, Input } from "@repo/ui";
import { resendVerificationSchema } from "@repo/validation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { FormAlert } from "./form";

const COOLDOWN_SECONDS = 30;

/**
 * Sends a new verification link. With `email` it's a single button (after signup);
 * without, it asks for the address. The response is the same whether or not the email exists.
 */
export function ResendVerification({ email: knownEmail }: { email?: string }) {
  const [email, setEmail] = useState(knownEmail ?? "");
  const [emailError, setEmailError] = useState<string>();
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string>();
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function send() {
    const parsed = resendVerificationSchema.safeParse({ email });
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message);
      return;
    }
    setEmailError(undefined);
    setError(undefined);
    setStatus("sending");
    try {
      await api("/auth/verification/resend", { method: "POST", body: parsed.data });
      setStatus("sent");
      setCooldown(COOLDOWN_SECONDS);
    } catch (caught) {
      setError(errorMessage(caught));
      setStatus("idle");
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      {!knownEmail && (
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={emailError}
        />
      )}
      {status === "sent" && (
        <FormAlert tone="success">If that email needs verifying, a new link is on its way.</FormAlert>
      )}
      {error && <FormAlert>{error}</FormAlert>}
      <Button type="submit" variant="secondary" fullWidth loading={status === "sending"} disabled={cooldown > 0}>
        {cooldown > 0 ? `Send again in ${cooldown}s` : status === "sent" ? "Send again" : "Send a new link"}
      </Button>
    </form>
  );
}
