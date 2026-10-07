import type { Metadata } from "next";
import { RedirectIfSignedIn } from "../../../components/auth/redirect-if-signed-in";
import { SignupForm } from "../../../components/auth/signup-form";

export const metadata: Metadata = { title: "Create your account" };

export default function SignupPage() {
  return (
    <>
      <RedirectIfSignedIn />
      <SignupForm />
    </>
  );
}
