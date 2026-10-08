"use client";

import type { PhoneCodeSentResponse, ProfileResponse } from "@repo/types";
import { Badge, Button, Card, Dialog, Input } from "@repo/ui";
import { phoneNumberSchema, twoFactorCodeSchema } from "@repo/validation";
import { CircleCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiRequestError, errorMessage } from "../../lib/api";
import { CodeInput } from "../auth/code-input";
import { FormAlert } from "../auth/form";
import { useReauthGate } from "./reauth";

/**
 * Optional mobile number. Add -> enter number -> send code -> enter code -> verified. The number counts
 * only after the server confirms the code; until then it is shown as waiting for a code.
 */
export function MobileCard({ profile, onChanged }: { profile: ProfileResponse; onChanged: () => void }) {
  const { mobile } = profile;
  const gate = useReauthGate();
  const [mode, setMode] = useState<"auto" | "enter">("auto");
  const [number, setNumber] = useState("");
  // Kept in memory only (never storage) so "Resend" can reuse it; after a page reload the person re-enters it.
  const [sentTo, setSentTo] = useState<string>();
  const [code, setCode] = useState("");
  const [numberError, setNumberError] = useState<string>();
  const [codeError, setCodeError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState<"send" | "verify" | "remove">();
  const [resendIn, setResendIn] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const step = mode === "enter" ? "enter" : mobile.pending ? "code" : "idle";

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  function failed(error: unknown, field: "number" | "code" | "form") {
    const message = errorMessage(error);
    if (error instanceof ApiRequestError && error.code === "VALIDATION_FAILED" && field === "number") setNumberError(error.issues?.[0]?.message ?? message);
    else if (field === "number") setNumberError(message);
    else if (field === "code") setCodeError(message);
    else setFormError(message);
    setBusy(undefined);
  }

  async function sendCode(phoneNumber: string) {
    setBusy("send");
    await gate.run(
      async () => {
        const result = await api<PhoneCodeSentResponse>("/profile/mobile/send-code", { method: "POST", body: { phoneNumber } });
        setNotice(result.status === "already_verified" ? "That number is already verified." : undefined);
        setResendIn(result.resendAfterSeconds);
        setSentTo(phoneNumber);
        setMode("auto");
        setNumber("");
        setCode("");
        setBusy(undefined);
        onChanged();
      },
      (error) => failed(error, step === "enter" ? "number" : "form"),
    );
    setBusy(undefined);
  }

  function resend() {
    setFormError(undefined);
    setCodeError(undefined);
    if (sentTo) void sendCode(sentTo);
    else setMode("enter");
  }

  function submitNumber() {
    setNumberError(undefined);
    setFormError(undefined);
    const parsed = phoneNumberSchema.safeParse(number);
    if (!parsed.success) {
      setNumberError(parsed.error.issues[0]?.message);
      return;
    }
    void sendCode(parsed.data);
  }

  async function submitCode() {
    setCodeError(undefined);
    const parsed = twoFactorCodeSchema.safeParse(code);
    if (!parsed.success) {
      setCodeError(parsed.error.issues[0]?.message);
      return;
    }
    setBusy("verify");
    try {
      await api("/profile/mobile/verify", { method: "POST", body: { code: parsed.data } });
      setCode("");
      setSentTo(undefined);
      setNotice("Your mobile number is verified.");
      onChanged();
      setBusy(undefined);
    } catch (error) {
      failed(error, "code");
    }
  }

  async function remove() {
    setConfirmRemove(false);
    setBusy("remove");
    await gate.run(
      async () => {
        await api("/profile/mobile", { method: "DELETE" });
        setNotice("Your mobile number was removed.");
        setBusy(undefined);
        onChanged();
      },
      (error) => failed(error, "form"),
    );
    setBusy(undefined);
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-h2">Mobile number</h2>
          <p className="text-body-small text-text-secondary">Optional. Not needed to sign in or trade.</p>
        </div>
        {mobile.verified ? (
          <Badge tone="success" icon={<CircleCheck />}>
            Verified
          </Badge>
        ) : (
          <Badge>Not verified</Badge>
        )}
      </div>

      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {formError && <FormAlert>{formError}</FormAlert>}

      {!mobile.available ? (
        <p className="text-body-small text-text-secondary">Mobile verification isn&apos;t available right now.</p>
      ) : step === "enter" ? (
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            submitNumber();
          }}
        >
          <Input
            label="Mobile number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+14155550123"
            hint="Include the country code, like +14155550123."
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            error={numberError}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => setMode("auto")}>
              Cancel
            </Button>
            <Button type="submit" loading={busy === "send"}>
              Send code
            </Button>
          </div>
        </form>
      ) : step === "code" && mobile.pending ? (
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submitCode();
          }}
        >
          <p className="text-body-small text-text-secondary">
            We texted a 6-digit code to <span className="font-medium text-text-primary tabular-nums">{mobile.pending.masked}</span>. Code
            expires in 10 minutes.
          </p>
          <CodeInput label="6-digit code" hint="Type the code from the text message." value={code} onChange={(event) => setCode(event.target.value)} error={codeError} autoFocus />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" disabled={resendIn > 0} onClick={() => setMode("enter")}>
                Use a different number
              </Button>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="secondary" loading={busy === "send"} disabled={resendIn > 0} onClick={resend}>
                {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </Button>
              <Button type="submit" loading={busy === "verify"}>
                Verify
              </Button>
            </div>
          </div>
        </form>
      ) : mobile.verified && mobile.masked ? (
        <div className="flex flex-col gap-4">
          <p className="text-body tabular-nums">{mobile.masked}</p>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setMode("enter")}>
              Change number
            </Button>
            <Button variant="ghost" loading={busy === "remove"} onClick={() => setConfirmRemove(true)}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button variant="secondary" onClick={() => setMode("enter")}>
            Add mobile number
          </Button>
        </div>
      )}

      <Dialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title="Remove mobile number?"
        description="We'll stop using this number. You can add it again any time."
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Remove number
            </Button>
          </div>
        }
      />
      {gate.dialog}
    </Card>
  );
}
