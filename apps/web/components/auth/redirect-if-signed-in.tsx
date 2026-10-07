"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "../../lib/auth";
import { safeRedirectPath } from "../../lib/routes";

/** Sends already signed-in visitors from the sign-in and sign-up pages into the app. */
export function RedirectIfSignedIn() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.status === "authenticated") {
      router.replace(safeRedirectPath(new URLSearchParams(window.location.search).get("next")));
    }
  }, [auth.status, router]);

  return null;
}
