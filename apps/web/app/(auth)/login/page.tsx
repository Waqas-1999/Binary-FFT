import type { Metadata } from "next";
import { LoginForm } from "../../../components/auth/login-form";
import { RedirectIfSignedIn } from "../../../components/auth/redirect-if-signed-in";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <>
      <RedirectIfSignedIn />
      <LoginForm />
    </>
  );
}
