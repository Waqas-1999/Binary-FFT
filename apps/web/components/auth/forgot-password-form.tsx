"use client";

import { Button, Input } from "@repo/ui";
import { forgotPasswordSchema } from "@repo/validation";
import { KeyRound, MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api, ApiRequestError, errorMessage } from "../../lib/api";
import { authRoutes } from "../../lib/routes";
import { AuthHeading, type FieldErrors, fieldErrorsFrom, FormAlert } from "./form";

const iconClasses = "flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand-soft-text";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string>();

  async function submit() {
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setErrors(fieldErrorsFrom(parsed.error));
      return;
    }
    setErrors({});
    setFormError(undefined);
    setSubmitting(true);
    try {
      await api("/auth/forgot-password", { method: "POST", body: { email } });
      setSentTo(parsed.data.email);
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "VALIDATION_FAILED") setErrors(fieldErrorsFrom(error));
      else setFormError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  // The same message appears whether or not the address has an account.
  if (sentTo) {
    return (
      <div className="flex flex-col gap-6">
        <span aria-hidden="true" className={iconClasses}>
          <MailCheck className="size-6" />
        </span>
        <AuthHeading
          title="Check your email"
          description={
            <>
              If an account exists for <strong className="font-semibold text-text-primary">{sentTo}</strong>, we&apos;ve sent a link
              to reset your password. It works once and expires in 1 hour.
            </>
          }
        />
        <p className="text-body-small text-text-secondary">Nothing arrived? Check your spam folder, or try again in a few minutes.</p>
        <Link href={authRoutes.login} className="focus-ring rounded-sm text-body-small font-semibold text-brand hover:text-brand-hover">
          Back to sign in
        </Link>
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
      <span aria-hidden="true" className={iconClasses}>
        <KeyRound className="size-6" />
      </span>
      <AuthHeading title="Forgot your password?" description="Enter your email and we'll send you a link to choose a new one." />
      {formError && <FormAlert>{formError}</FormAlert>}
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="you@example.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={errors.email}
      />
      <Button type="submit" size="lg" fullWidth loading={submitting}>
        Send reset link
      </Button>
      <Link href={authRoutes.login} className="focus-ring self-center rounded-sm text-body-small font-semibold text-brand hover:text-brand-hover">
        Back to sign in
      </Link>
    </form>
  );
}
