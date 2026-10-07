import { buttonStyles } from "@repo/ui";
import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthHeading } from "../../../components/auth/form";
import { authRoutes } from "../../../lib/routes";

export const metadata: Metadata = { title: "Forgot password" };

/** Placeholder: password recovery arrives in a later phase. */
export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand-soft-text">
        <KeyRound className="size-6" />
      </span>
      <AuthHeading title="Forgot your password?" description="Password reset is coming soon." />
      <Link href={authRoutes.login} className={buttonStyles({ variant: "secondary", fullWidth: true })}>
        Back to sign in
      </Link>
    </div>
  );
}
