"use client";

import type { AuthUser, SessionResponse } from "@repo/types";
import { useEffect, useSyncExternalStore } from "react";
import { api, ApiRequestError } from "./api";

export type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: AuthUser }
  | { status: "unauthenticated" };

const LOADING: AuthState = { status: "loading" };

// Minimal module-level store: the session itself lives in an HttpOnly cookie the browser can't read.
let state: AuthState = LOADING;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setState(next: AuthState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Asks the API who is signed in. Concurrent callers share one request. */
export function refreshSession(): Promise<void> {
  pending ??= api<SessionResponse>("/auth/session")
    .then(({ user }) => setState({ status: "authenticated", user }))
    .catch((error: unknown) => {
      // Network problems leave a known session in place; anything else means signed out.
      if (!(error instanceof ApiRequestError && error.code === "NETWORK_ERROR" && state.status === "authenticated")) {
        setState({ status: "unauthenticated" });
      }
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function setAuthenticated(user: AuthUser): void {
  setState({ status: "authenticated", user });
}

export async function logout(): Promise<void> {
  await api("/auth/logout", { method: "POST" });
  setState({ status: "unauthenticated" });
}

/** Current auth status. Starts as "loading" and checks the session once per page load. */
export function useAuth(): AuthState {
  useEffect(() => {
    if (state.status === "loading") void refreshSession();
  }, []);
  return useSyncExternalStore(subscribe, () => state, () => LOADING);
}

/** Test helper: restores the initial state. */
export function resetAuthForTests(): void {
  pending = null;
  setState(LOADING);
}
