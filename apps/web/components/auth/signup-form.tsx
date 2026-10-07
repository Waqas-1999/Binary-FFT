"use client";

import { Button, Input, PasswordInput } from "@repo/ui";
import { passwordPolicy, signupSchema } from "@repo/validation";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api, ApiRequestError, errorMessage } from "../../lib/api";
import { authRoutes } from "../../lib/routes";
import { AuthHeading, type FieldErrors, fieldErrorsFrom, FormAlert } from "./form";
import { ResendVerification } from "./resend-verification";

export function SignupForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string>();

  async function submit() {
    const parsed = signupSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(fieldErrorsFrom(parsed.error));
      return;
    }
    setErrors({});
    setFormError(undefined);
    setSubmitting(true);
    try {
      await api("/auth/signup", { method: "POST", body: { email, password } });
      setSentTo(parsed.data.email);
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "VALIDATION_FAILED") setErrors(fieldErrorsFrom(error));
      else setFormError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  if (sentTo) {
    return (
      <div className="flex flex-col gap-6">
        <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand-soft-text">
          <MailCheck className="size-6" />
        </span>
        <AuthHeading
          title="Verify your email"
          description={
            <>
              We sent a link to <strong className="font-semibold text-text-primary">{sentTo}</strong>. Open it to finish
              creating your account.
            </>
          }
        />
        <p className="text-body-small text-text-secondary">Can&apos;t find it? Check your spam folder, or:</p>
        <ResendVerification email={sentTo} />
        <Button variant="ghost" onClick={() => setSentTo(undefined)}>
          Use a different email
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
      <AuthHeading title="Create your account" description="It only takes a minute." />
      {formError && <FormAlert>{formError}</FormAlert>}
      <div className="flex flex-col gap-5">
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
        <PasswordInput
          label="Create a password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          hint={`At least ${passwordPolicy.minLength} characters. A short phrase is easy to remember.`}
          error={errors.password}
        />
      </div>
      <Button type="submit" size="lg" fullWidth loading={submitting}>
        Create account
      </Button>
      <p className="text-center text-body-small text-text-secondary">
        Already have an account?{" "}
        <Link href={authRoutes.login} className="focus-ring rounded-sm font-semibold text-brand hover:text-brand-hover">
          Sign in
        </Link>
      </p>
    </form>
  );
}
