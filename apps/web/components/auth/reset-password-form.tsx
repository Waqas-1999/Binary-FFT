"use client";

import { Button, buttonStyles, PasswordInput, Spinner } from "@repo/ui";
import { passwordPolicy, resetPasswordSchema } from "@repo/validation";
import { CircleCheck, KeyRound, LinkIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, ApiRequestError, errorMessage } from "../../lib/api";
import { refreshSession } from "../../lib/auth";
import { authRoutes } from "../../lib/routes";
import { AuthHeading, type FieldErrors, fieldErrorsFrom, FormAlert } from "./form";

type Step = { name: "reading" } | { name: "no-link" } | { name: "invalid" } | { name: "ready"; token: string } | { name: "done" };

const iconClasses = "flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand-soft-text";

/**
 * Reset page. The one-time token arrives in the URL fragment (`#token=...`), which browsers never send
 * to servers. It is read once, removed from the address bar, kept only in memory, and used only when the
 * person submits a new password, so link scanners that merely open the page cannot consume it.
 */
export function ResetPasswordForm() {
  const [step, setStep] = useState<Step>({ name: "reading" });
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const tokenRead = useRef(false);

  useEffect(() => {
    if (tokenRead.current) return;
    tokenRead.current = true;

    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);

    const well = token !== null && resetPasswordSchema.shape.token.safeParse(token).success;
    queueMicrotask(() => setStep(token === null ? { name: "no-link" } : well ? { name: "ready", token } : { name: "invalid" }));
  }, []);

  async function submit(token: string) {
    const parsed = resetPasswordSchema.safeParse({ token, password });
    if (!parsed.success) {
      setErrors(fieldErrorsFrom(parsed.error));
      return;
    }
    setErrors({});
    setFormError(undefined);
    setSubmitting(true);
    try {
      await api("/auth/reset-password", { method: "POST", body: { token, password } });
      setPassword("");
      setStep({ name: "done" });
      void refreshSession(); // every session was revoked; make the app notice
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "PASSWORD_RESET_INVALID") setStep({ name: "invalid" });
      else if (error instanceof ApiRequestError && error.code === "VALIDATION_FAILED") setErrors(fieldErrorsFrom(error));
      else setFormError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  switch (step.name) {
    case "reading":
      return (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      );

    case "done":
      return (
        <div className="flex flex-col gap-6">
          <span aria-hidden="true" className={iconClasses}>
            <CircleCheck className="size-6" />
          </span>
          <AuthHeading
            title="Password updated"
            description="You've been signed out everywhere for your security. Sign in again with your new password."
          />
          <Link href={authRoutes.login} className={buttonStyles({ size: "lg", fullWidth: true })}>
            Sign in
          </Link>
        </div>
      );

    case "invalid":
    case "no-link":
      return (
        <div className="flex flex-col gap-6">
          <span aria-hidden="true" className={iconClasses}>
            <LinkIcon className="size-6" />
          </span>
          <AuthHeading
            title={step.name === "invalid" ? "This link no longer works" : "Reset your password"}
            description={
              step.name === "invalid"
                ? "It may have expired or already been used. Request a new link to choose a new password."
                : "Open the link we emailed you, or request a new one."
            }
          />
          <Link href={authRoutes.forgotPassword} className={buttonStyles({ size: "lg", fullWidth: true })}>
            Request a new link
          </Link>
          <Link href={authRoutes.login} className="focus-ring self-center rounded-sm text-body-small font-semibold text-brand hover:text-brand-hover">
            Back to sign in
          </Link>
        </div>
      );

    case "ready":
      return (
        <form
          noValidate
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(step.token);
          }}
        >
          <span aria-hidden="true" className={iconClasses}>
            <KeyRound className="size-6" />
          </span>
          <AuthHeading title="Choose a new password" description="You'll be signed out everywhere and asked to sign in again." />
          {formError && <FormAlert>{formError}</FormAlert>}
          <PasswordInput
            label="New password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            hint={`At least ${passwordPolicy.minLength} characters. A short phrase is easy to remember.`}
            error={errors.password}
          />
          <Button type="submit" size="lg" fullWidth loading={submitting}>
            Update password
          </Button>
        </form>
      );
  }
}
