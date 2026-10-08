import type { Metadata } from "next";
import { ResetPasswordForm } from "../../../components/auth/reset-password-form";

// The reset token lives in the URL fragment: keep the page out of search results and never send a referrer.
export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
