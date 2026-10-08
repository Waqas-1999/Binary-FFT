"use client";

import type { SessionResponse } from "@repo/types";
import { Button, Input } from "@repo/ui";
import { recoveryCodeSchema, twoFactorCodeSchema } from "@repo/validation";
import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiRequestError, errorMessage } from "../../lib/api";
import { setAuthenticated } from "../../lib/auth";
import { safeRedirectPath } from "../../lib/routes";
import { CodeInput } from "./code-input";
import { AuthHeading, FormAlert } from "./form";

const linkButton = "focus-ring self-center rounded-sm text-body-small font-semibold text-brand hover:text-brand-hover";

/**
 * Second step of signing in for accounts with two-factor on. The server holds the pending sign-in in an
 * HttpOnly cookie, so nothing secret is kept here: only the code being typed.
 */
export function TwoFactorChallenge({ onRestart }: { onRestart: () => void }) {
  const router = useRouter();
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [expired, setExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const schema = useRecovery ? recoveryCodeSchema : twoFactorCodeSchema;
    const parsed = schema.safeParse(code);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message);
      return;
    }
    setFieldError(undefined);
    setFormError(undefined);
    setSubmitting(true);
    try {
      const { user } = await api<SessionResponse>(useRecovery ? "/auth/2fa/recovery" : "/auth/2fa/verify", {
        method: "POST",
        body: { code },
      });
      setAuthenticated(user);
      router.replace(safeRedirectPath(new URLSearchParams(window.location.search).get("next")));
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "TWO_FACTOR_CHALLENGE_INVALID") setExpired(true);
      setFormError(errorMessage(error));
      setSubmitting(false);
    }
  }

  function switchMode() {
    setUseRecovery((current) => !current);
    setCode("");
    setFieldError(undefined);
    setFormError(undefined);
  }

  if (expired) {
    return (
      <div className="flex flex-col gap-6">
        <AuthHeading title="Sign in again" description="Your sign-in timed out or was used up. Start again to get a new one." />
        <Button size="lg" fullWidth onClick={onRestart}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand-soft-text">
        <ShieldCheck className="size-6" />
      </span>
      <AuthHeading
        title={useRecovery ? "Use a recovery code" : "Enter your authenticator code"}
        description={
          useRecovery
            ? "Enter one of the recovery codes you saved when you turned on two-factor authentication. Each works once."
            : "Open your authenticator app and enter the 6-digit code for this account."
        }
      />
      {formError && <FormAlert>{formError}</FormAlert>}
      {useRecovery ? (
        <Input
          key="recovery"
          label="Recovery code"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="characters"
          placeholder="XXXX-XXXX-XXXX-XXXX"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          error={fieldError}
          autoFocus
        />
      ) : (
        <CodeInput key="totp" label="6-digit code" value={code} onChange={(event) => setCode(event.target.value)} error={fieldError} autoFocus />
      )}
      <Button type="submit" size="lg" fullWidth loading={submitting}>
        Verify
      </Button>
      <button type="button" className={linkButton} onClick={switchMode}>
        {useRecovery ? "Use my authenticator app instead" : "Use a recovery code"}
      </button>
      <button type="button" className={linkButton} onClick={onRestart}>
        Back to sign in
      </button>
    </form>
  );
}
