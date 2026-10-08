"use client";

import type { SecurityStatus } from "@repo/types";
import { Button, Dialog, PasswordInput } from "@repo/ui";
import { twoFactorCodeSchema } from "@repo/validation";
import { useState, type ReactNode } from "react";
import { api, ApiRequestError, errorMessage } from "../../lib/api";
import { CodeInput } from "../auth/code-input";
import { FormAlert } from "../auth/form";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  status: SecurityStatus;
  /** Performs the action once the person is recently authenticated and has given a fresh code. */
  run: (code: string) => Promise<void>;
}

/**
 * Confirmation for sensitive account changes. The server decides whether the session is recent enough;
 * this dialog only collects what it needs (password, or a trip through Google, plus a fresh authenticator
 * code) and shows the server's verdict.
 */
export function SensitiveActionDialog({ open, onClose, title, description, confirmLabel, danger, status, run }: Props) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [passwordError, setPasswordError] = useState<string>();
  const [codeError, setCodeError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const needsPassword = status.hasPassword && !status.recentlyAuthenticated && !confirmed;
  const needsGoogle = !status.hasPassword && !status.recentlyAuthenticated && !confirmed;

  function close() {
    setPassword("");
    setCode("");
    setPasswordError(undefined);
    setCodeError(undefined);
    setFormError(undefined);
    onClose();
  }

  async function confirmWithGoogle() {
    setSubmitting(true);
    setFormError(undefined);
    try {
      const { authorizationUrl } = await api<{ authorizationUrl: string }>("/auth/google/reauth", { method: "POST" });
      window.location.assign(authorizationUrl);
    } catch (error) {
      setFormError(errorMessage(error));
      setSubmitting(false);
    }
  }

  async function submit() {
    const parsed = twoFactorCodeSchema.safeParse(code);
    setCodeError(parsed.success ? undefined : parsed.error.issues[0]?.message);
    setPasswordError(needsPassword && !password ? "Enter your password" : undefined);
    if (!parsed.success || (needsPassword && !password)) return;

    setFormError(undefined);
    setSubmitting(true);
    try {
      if (needsPassword) {
        try {
          await api("/auth/reauthenticate", { method: "POST", body: { password } });
        } catch (error) {
          if (error instanceof ApiRequestError && error.code === "INVALID_CREDENTIALS") {
            setPasswordError("That password isn't right.");
            return;
          }
          throw error;
        }
        setConfirmed(true);
      }
      await run(parsed.data);
      close();
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "TWO_FACTOR_CODE_INVALID") setCodeError(errorMessage(error));
      else setFormError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} title={title} description={description}>
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {formError && <FormAlert>{formError}</FormAlert>}
        {needsPassword && (
          <PasswordInput label="Your password" value={password} onChange={(event) => setPassword(event.target.value)} error={passwordError} />
        )}
        {needsGoogle ? (
          <>
            <p className="text-body-small text-text-secondary">
              For your security, confirm it&apos;s you by signing in with Google again. You&apos;ll come back here afterwards.
            </p>
            <Button type="button" loading={submitting} onClick={() => void confirmWithGoogle()}>
              Confirm with Google
            </Button>
          </>
        ) : (
          <>
            <CodeInput
              label="Authenticator code"
              hint="Use a new code from your app. A code you've just used won't work again."
              value={code}
              onChange={(event) => setCode(event.target.value)}
              error={codeError}
            />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" variant={danger ? "danger" : "primary"} loading={submitting}>
                {confirmLabel}
              </Button>
            </div>
          </>
        )}
      </form>
    </Dialog>
  );
}
