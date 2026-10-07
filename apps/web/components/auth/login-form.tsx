"use client";

import type { SessionResponse } from "@repo/types";
import { Button, Input, PasswordInput } from "@repo/ui";
import { loginSchema } from "@repo/validation";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiRequestError, errorMessage } from "../../lib/api";
import { setAuthenticated } from "../../lib/auth";
import { authRoutes, safeRedirectPath } from "../../lib/routes";
import { AuthHeading, type FieldErrors, fieldErrorsFrom, FormAlert } from "./form";

const linkClasses = "focus-ring rounded-sm font-semibold text-brand hover:text-brand-hover";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(fieldErrorsFrom(parsed.error));
      return;
    }
    setErrors({});
    setFormError(undefined);
    setSubmitting(true);
    try {
      const { user } = await api<SessionResponse>("/auth/login", { method: "POST", body: { email, password } });
      setAuthenticated(user);
      router.replace(safeRedirectPath(new URLSearchParams(window.location.search).get("next")));
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "VALIDATION_FAILED") setErrors(fieldErrorsFrom(error));
      else setFormError(errorMessage(error));
      setSubmitting(false);
    }
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
      <AuthHeading title="Welcome back" description="Sign in to continue." />
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
        <div className="flex flex-col gap-2">
          <PasswordInput
            label="Password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={errors.password}
          />
          <Link href={authRoutes.forgotPassword} className={`${linkClasses} self-end py-2 text-body-small`}>
            Forgot password?
          </Link>
        </div>
      </div>
      <Button type="submit" size="lg" fullWidth loading={submitting}>
        Sign in
      </Button>
      <p className="text-center text-body-small text-text-secondary">
        New here?{" "}
        <Link href={authRoutes.signup} className={linkClasses}>
          Create an account
        </Link>
      </p>
    </form>
  );
}
