"use client";

import type { SecurityStatus } from "@repo/types";
import { Button, Dialog, PasswordInput, Spinner } from "@repo/ui";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiRequestError, errorMessage } from "../../lib/api";
import { FormAlert } from "../auth/form";

/**
 * Asks the person to confirm it's them: their password, or a trip through Google for accounts without
 * one. The server stamps the session; nothing here decides whether the session counts as recent.
 */
export function ReauthDialog({ open, onClose, onConfirmed }: { open: boolean; onClose: () => void; onConfirmed: () => void }) {
  const [hasPassword, setHasPassword] = useState<boolean>();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api<SecurityStatus>("/auth/security")
      .then((status) => !cancelled && setHasPassword(status.hasPassword))
      .catch((caught: unknown) => !cancelled && setError(errorMessage(caught)));
    return () => {
      cancelled = true;
    };
  }, [open]);

  function close() {
    setPassword("");
    setError(undefined);
    setHasPassword(undefined);
    onClose();
  }

  async function confirmWithPassword() {
    if (!password) {
      setError("Enter your password");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await api("/auth/reauthenticate", { method: "POST", body: { password } });
      setPassword("");
      setHasPassword(undefined);
      onConfirmed();
    } catch (caught) {
      setError(caught instanceof ApiRequestError && caught.code === "INVALID_CREDENTIALS" ? "That password isn't right." : errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmWithGoogle() {
    setSubmitting(true);
    setError(undefined);
    try {
      const { authorizationUrl } = await api<{ authorizationUrl: string }>("/auth/google/reauth", { method: "POST" });
      window.location.assign(authorizationUrl);
    } catch (caught) {
      setError(errorMessage(caught));
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} title="Confirm it's you" description="For your security, please confirm before we make this change.">
      <div className="flex flex-col gap-5">
        {error && <FormAlert>{error}</FormAlert>}
        {hasPassword === undefined && !error && (
          <div role="status" aria-label="Loading" className="flex justify-center py-4">
            <Spinner />
          </div>
        )}
        {hasPassword === true && (
          <form
            noValidate
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void confirmWithPassword();
            }}
          >
            <PasswordInput label="Your password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button type="submit" loading={submitting}>
                Confirm
              </Button>
            </div>
          </form>
        )}
        {hasPassword === false && (
          <>
            <p className="text-body-small text-text-secondary">
              Sign in with Google again to confirm. You&apos;ll come back here afterwards; then repeat what you were doing.
            </p>
            <Button type="button" loading={submitting} onClick={() => void confirmWithGoogle()}>
              Confirm with Google
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}

/**
 * Runs an action that needs a recent authentication. If the server says the session is no longer recent,
 * the confirmation dialog opens and the action is retried once the person has confirmed.
 */
export function useReauthGate(): { run: (action: () => Promise<void>, onError: (error: unknown) => void) => Promise<void>; dialog: ReactNode } {
  const [pending, setPending] = useState<{ action: () => Promise<void>; onError: (error: unknown) => void }>();

  const run = useCallback(async (action: () => Promise<void>, onError: (error: unknown) => void) => {
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "REAUTHENTICATION_REQUIRED") setPending({ action, onError });
      else onError(error);
    }
  }, []);

  const dialog = (
    <ReauthDialog
      open={pending !== undefined}
      onClose={() => setPending(undefined)}
      onConfirmed={() => {
        const retry = pending;
        setPending(undefined);
        if (retry) void retry.action().catch(retry.onError);
      }}
    />
  );
  return { run, dialog };
}
