"use client";

import type { SecurityStatus } from "@repo/types";
import { Button, Card, Dialog, PasswordInput } from "@repo/ui";
import { changePasswordSchema, passwordPolicy } from "@repo/validation";
import { useState } from "react";
import { api, ApiRequestError, errorMessage } from "../../lib/api";
import { CodeInput } from "../auth/code-input";
import { type FieldErrors, fieldErrorsFrom, FormAlert } from "../auth/form";

/** Change password. Accounts that sign in with Google only have no password, so there is nothing to change. */
export function PasswordCard({ status, onChanged }: { status: SecurityStatus; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const needsCode = status.twoFactor.enabled;

  function close() {
    setOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setCode("");
    setErrors({});
    setFormError(undefined);
  }

  async function submit() {
    const body = { currentPassword, newPassword, ...(needsCode ? { code } : {}) };
    const parsed = changePasswordSchema.safeParse(body);
    const missingCode = needsCode && !code.trim();
    if (!parsed.success || missingCode) {
      setErrors({ ...(parsed.success ? {} : fieldErrorsFrom(parsed.error)), ...(missingCode ? { code: "Enter the 6-digit code" } : {}) });
      return;
    }
    setErrors({});
    setFormError(undefined);
    setSubmitting(true);
    try {
      const result = await api<{ revokedSessions: number }>("/auth/change-password", { method: "POST", body });
      close();
      setNotice(
        result.revokedSessions > 0
          ? "Your password was changed and your other devices were signed out."
          : "Your password was changed.",
      );
      onChanged();
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "INVALID_CREDENTIALS") setErrors({ currentPassword: "That password isn't right." });
      else if (error instanceof ApiRequestError && error.code === "TWO_FACTOR_CODE_INVALID") setErrors({ code: errorMessage(error) });
      else if (error instanceof ApiRequestError && error.code === "VALIDATION_FAILED") setErrors(fieldErrorsFrom(error));
      else setFormError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-h2">Password</h2>
        <p className="text-body-small text-text-secondary">
          {status.hasPassword
            ? "Changing your password signs you out of your other devices."
            : "You sign in with Google, so there's no password to change."}
        </p>
      </div>
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {status.hasPassword && (
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              setNotice(undefined);
              setOpen(true);
            }}
          >
            Change password
          </Button>
        </div>
      )}

      <Dialog open={open} onClose={close} title="Change password" description="Enter your current password, then choose a new one.">
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {formError && <FormAlert>{formError}</FormAlert>}
          <PasswordInput label="Current password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} error={errors.currentPassword} />
          <PasswordInput
            label="New password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            hint={`At least ${passwordPolicy.minLength} characters. A short phrase is easy to remember.`}
            error={errors.newPassword}
          />
          {needsCode && <CodeInput label="Authenticator code" value={code} onChange={(event) => setCode(event.target.value)} error={errors.code} />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Change password
            </Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
