"use client";

import type { SessionResponse } from "@repo/types";
import { Button, buttonStyles, Spinner } from "@repo/ui";
import { verifyEmailSchema } from "@repo/validation";
import { CircleCheck, Mail } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiRequestError, errorMessage } from "../../lib/api";
import { setAuthenticated } from "../../lib/auth";
import { appRoutes, authRoutes } from "../../lib/routes";
import { AuthHeading, FormAlert } from "./form";
import { ResendVerification } from "./resend-verification";

type Step =
  | { name: "reading" }
  | { name: "no-link" }
  | { name: "verifying" }
  | { name: "verified" }
  | { name: "invalid" }
  | { name: "error"; token: string; message: string };

const iconClasses = "flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand-soft-text";

export function VerifyEmail() {
  const [step, setStep] = useState<Step>({ name: "reading" });
  const verificationStarted = useRef(false);

  const verify = useCallback(async (token: string) => {
    setStep({ name: "verifying" });
    try {
      const { user } = await api<SessionResponse>("/auth/verify-email", { method: "POST", body: { token } });
      setAuthenticated(user);
      setStep({ name: "verified" });
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "VERIFICATION_LINK_INVALID") setStep({ name: "invalid" });
      else setStep({ name: "error", token, message: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    if (verificationStarted.current) return;
    verificationStarted.current = true;

    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);

    if (!token) {
      queueMicrotask(() => setStep({ name: "no-link" }));
    } else if (!verifyEmailSchema.safeParse({ token }).success) {
      queueMicrotask(() => setStep({ name: "invalid" }));
    } else {
      window.setTimeout(() => void verify(token), 0);
    }
  }, [verify]);

  switch (step.name) {
    case "reading":
      return (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      );

    case "verified":
      return (
        <div className="flex flex-col gap-6">
          <span aria-hidden="true" className={iconClasses}>
            <CircleCheck className="size-6" />
          </span>
          <AuthHeading title="Your email is verified" description="Your account is ready and you're signed in." />
          <Link href={appRoutes.trade} className={buttonStyles({ size: "lg", fullWidth: true })}>
            Continue
          </Link>
        </div>
      );

    case "invalid":
    case "no-link":
      return (
        <div className="flex flex-col gap-6">
          <span aria-hidden="true" className={iconClasses}>
            <Mail className="size-6" />
          </span>
          <AuthHeading
            title={step.name === "invalid" ? "This link no longer works" : "Verify your email"}
            description={
              step.name === "invalid"
                ? "It may have expired or already been used. If you've already verified your email, sign in; otherwise request a new link below."
                : "Open the link we sent to your email. Need a new one? Enter your email below."
            }
          />
          {step.name === "invalid" && (
            <Link href={authRoutes.login} className="text-body-small text-link underline">
              Sign in
            </Link>
          )}
          <ResendVerification />
        </div>
      );

    default:
      return (
        <div className="flex flex-col gap-6">
          <span aria-hidden="true" className={iconClasses}>
            <Mail className="size-6" />
          </span>
          <AuthHeading title="Verify your email" description="Confirm this is your email address to finish signing up." />
          {step.name === "error" && <FormAlert>{step.message}</FormAlert>}
          <Button
            size="lg"
            fullWidth
            loading={step.name === "verifying"}
            onClick={() => {
              if (step.name === "error") void verify(step.token);
            }}
          >
            {step.name === "verifying" ? "Verifying..." : "Try verification again"}
          </Button>
        </div>
      );
  }
}
