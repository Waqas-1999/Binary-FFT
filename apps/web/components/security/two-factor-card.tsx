"use client";

import type { RecoveryCodesResponse, SecurityStatus, TwoFactorSetup } from "@repo/types";
import { Badge, Button, Card } from "@repo/ui";
import { twoFactorCodeSchema } from "@repo/validation";
import { CircleCheck, Copy, KeyRound } from "lucide-react";
import { useState } from "react";
import { api, ApiRequestError, errorMessage } from "../../lib/api";
import { CodeInput } from "../auth/code-input";
import { FormAlert } from "../auth/form";
import { QrCode } from "./qr-code";
import { SensitiveActionDialog } from "./sensitive-action-dialog";

type Mode =
  | { name: "idle" }
  | { name: "setup" }
  | { name: "codes"; codes: string[]; reason: "enabled" | "regenerated" };

/**
 * Two-factor authentication on Profile > Security. Setup runs inline (not in a dialog that Escape could
 * dismiss) so the one-time recovery codes can never be lost by a stray keypress.
 */
export function TwoFactorCard({ status, onChanged }: { status: SecurityStatus; onChanged: () => void }) {
  const [mode, setMode] = useState<Mode>({ name: "idle" });
  const [dialog, setDialog] = useState<"disable" | "regenerate">();
  const [notice, setNotice] = useState<string>();
  const enabled = status.twoFactor.enabled;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-h2">Two-factor authentication</h2>
          <p className="text-body-small text-text-secondary">
            Ask for a code from your authenticator app when you sign in, on top of your password or Google.
          </p>
        </div>
        {enabled ? (
          <Badge tone="success" icon={<CircleCheck />}>
            On
          </Badge>
        ) : (
          <Badge>Off</Badge>
        )}
      </div>

      {notice && <FormAlert tone="success">{notice}</FormAlert>}

      {mode.name === "setup" && (
        <SetupWizard
          onCancel={() => setMode({ name: "idle" })}
          onEnabled={(codes) => {
            setMode({ name: "codes", codes, reason: "enabled" });
            onChanged();
          }}
        />
      )}

      {mode.name === "codes" && (
        <RecoveryCodesPanel
          codes={mode.codes}
          onDone={() => {
            setNotice(mode.reason === "enabled" ? "Two-factor authentication is on." : "Your new recovery codes are ready. The old ones no longer work.");
            setMode({ name: "idle" });
          }}
        />
      )}

      {mode.name === "idle" &&
        (enabled ? (
          <div className="flex flex-col gap-4">
            <p className="text-body-small text-text-secondary">
              {status.twoFactor.recoveryCodesRemaining} of 10 recovery codes left. Each works once, if you lose your phone.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button variant="secondary" onClick={() => setDialog("regenerate")}>
                Get new recovery codes
              </Button>
              <Button variant="danger" onClick={() => setDialog("disable")}>
                Turn off
              </Button>
            </div>
          </div>
        ) : status.twoFactorAvailable ? (
          <div>
            <Button
              onClick={() => {
                setNotice(undefined);
                setMode({ name: "setup" });
              }}
            >
              Set up authenticator
            </Button>
          </div>
        ) : (
          <FormAlert>Two-factor authentication isn&apos;t available on this server yet.</FormAlert>
        ))}

      <SensitiveActionDialog
        open={dialog === "disable"}
        onClose={() => setDialog(undefined)}
        title="Turn off two-factor authentication?"
        description="Your account will be protected by your sign-in method alone, and your recovery codes will stop working."
        confirmLabel="Turn off"
        danger
        status={status}
        run={async (code) => {
          await api("/auth/2fa/disable", { method: "POST", body: { code } });
          setNotice("Two-factor authentication is off.");
          onChanged();
        }}
      />
      <SensitiveActionDialog
        open={dialog === "regenerate"}
        onClose={() => setDialog(undefined)}
        title="Get new recovery codes?"
        description="Your current codes will stop working as soon as you do. You'll see the new ones once."
        confirmLabel="Get new codes"
        status={status}
        run={async (code) => {
          const { recoveryCodes } = await api<RecoveryCodesResponse>("/auth/2fa/recovery-codes", { method: "POST", body: { code } });
          setNotice(undefined);
          setMode({ name: "codes", codes: recoveryCodes, reason: "regenerated" });
          onChanged();
        }}
      />
    </Card>
  );
}

type Step = "intro" | "scan" | "code";

function SetupWizard({ onCancel, onEnabled }: { onCancel: () => void; onEnabled: (codes: string[]) => void }) {
  const [step, setStep] = useState<Step>("intro");
  const [setup, setSetup] = useState<TwoFactorSetup>();
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(undefined);
    try {
      setSetup(await api<TwoFactorSetup>("/auth/2fa/setup", { method: "POST" }));
      setStep("scan");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    const parsed = twoFactorCodeSchema.safeParse(code);
    if (!parsed.success) {
      setCodeError(parsed.error.issues[0]?.message);
      return;
    }
    setCodeError(undefined);
    setError(undefined);
    setBusy(true);
    try {
      const { recoveryCodes } = await api<RecoveryCodesResponse>("/auth/2fa/confirm", { method: "POST", body: { code: parsed.data } });
      onEnabled(recoveryCodes);
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.code === "TWO_FACTOR_CODE_INVALID") setCodeError(errorMessage(caught));
      else setError(errorMessage(caught));
      setBusy(false);
    }
  }

  return (
    <section aria-label="Set up two-factor authentication" className="flex flex-col gap-5 rounded-md border border-border bg-surface-muted p-4 sm:p-5">
      {error && <FormAlert>{error}</FormAlert>}

      {step === "intro" && (
        <>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-h3">Protect your account</h3>
            <p className="text-body-small text-text-secondary">
              You&apos;ll need an authenticator app such as Google Authenticator, Microsoft Authenticator, 1Password or Bitwarden. It takes about a minute.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button loading={busy} onClick={() => void start()}>
              Continue
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      )}

      {step === "scan" && setup && (
        <>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-h3">Scan this QR code with your authenticator app</h3>
            <p className="text-body-small text-text-secondary">Can&apos;t scan it? Type the key below into your app instead.</p>
          </div>
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <QrCode value={setup.otpauthUri} label="QR code for your authenticator app" />
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-caption text-text-secondary">Setup key</span>
              <code className="rounded-sm bg-surface px-2.5 py-1.5 font-mono text-body-small tracking-wider break-all select-all">{setup.secret}</code>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setStep("code")}>I&apos;ve added it</Button>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </>
      )}

      {step === "code" && (
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <h3 className="text-h3">Enter the 6-digit code</h3>
            <p className="text-body-small text-text-secondary">Type the code your app shows for this account to finish.</p>
          </div>
          <CodeInput label="6-digit code" value={code} onChange={(event) => setCode(event.target.value)} error={codeError} autoFocus />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={busy}>
              Turn on
            </Button>
            <Button type="button" variant="ghost" onClick={() => setStep("scan")}>
              Back
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

/** Shows recovery codes exactly once. They live only in this component's state. */
function RecoveryCodesPanel({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section aria-label="Recovery codes" className="flex flex-col gap-5 rounded-md border border-border bg-surface-muted p-4 sm:p-5">
      <div className="flex flex-col gap-1.5">
        <h3 className="flex items-center gap-2 text-h3">
          <KeyRound aria-hidden="true" className="size-5" />
          Save your recovery codes
        </h3>
        <ul className="list-disc pl-5 text-body-small text-text-secondary">
          <li>Keep them somewhere safe, like a password manager.</li>
          <li>Each code works once, if you can&apos;t use your authenticator app.</li>
          <li>You won&apos;t be able to see these again. Getting new codes cancels these.</li>
        </ul>
      </div>
      <ul className="grid grid-cols-1 gap-2 rounded-md bg-surface p-3 font-mono text-body-small tabular-nums sm:grid-cols-2">
        {codes.map((code) => (
          <li key={code} className="select-all">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" icon={<Copy />} onClick={() => void copy()}>
          {copied ? "Copied" : "Copy codes"}
        </Button>
      </div>
      <label className="flex items-start gap-3 text-body-small">
        <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} className="focus-ring mt-0.5 size-5 shrink-0 accent-brand" />
        <span>I&apos;ve saved my recovery codes somewhere safe.</span>
      </label>
      <div>
        <Button disabled={!saved} onClick={onDone}>
          Done
        </Button>
      </div>
    </section>
  );
}
