"use client";

import type { ProfileResponse } from "@repo/types";
import { Avatar, Badge, Button, Card, Input, Select } from "@repo/ui";
import { displayNameMaxLength, displayNameSchema, timeZoneSchema } from "@repo/validation";
import { CircleCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { api, ApiRequestError, errorMessage } from "../../lib/api";
import { type FieldErrors, fieldErrorsFrom, FormAlert } from "../auth/form";

const DEVICE_SETTING = "";

/** Every IANA zone the browser knows, falling back to just the current one on older browsers. */
function timeZoneOptions(current: string | null): { value: string; label: string }[] {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const all = current && !zones.includes(current) ? [...zones, current] : zones;
  return [{ value: DEVICE_SETTING, label: "Use my device setting" }, ...all.map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") }))];
}

/** Account number, email and the few things a person can edit about themselves. */
export function ProfileDetailsCard({ profile, onChanged }: { profile: ProfileResponse; onChanged: () => void }) {
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [timeZone, setTimeZone] = useState(profile.settings.timeZone ?? DEVICE_SETTING);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const options = useMemo(() => timeZoneOptions(profile.settings.timeZone), [profile.settings.timeZone]);

  const trimmedName = displayName.trim();
  const unchanged = trimmedName === (profile.displayName ?? "") && timeZone === (profile.settings.timeZone ?? DEVICE_SETTING);

  async function save() {
    const next: Record<string, string | null> = {};
    const nextErrors: FieldErrors = {};

    if (trimmedName !== (profile.displayName ?? "")) {
      if (trimmedName === "") next.displayName = null;
      else {
        const parsed = displayNameSchema.safeParse(trimmedName);
        if (parsed.success) next.displayName = parsed.data;
        else nextErrors.displayName = parsed.error.issues[0]?.message;
      }
    }
    if (timeZone !== (profile.settings.timeZone ?? DEVICE_SETTING)) {
      if (timeZone === DEVICE_SETTING) next.timeZone = null;
      else {
        const parsed = timeZoneSchema.safeParse(timeZone);
        if (parsed.success) next.timeZone = parsed.data;
        else nextErrors.timeZone = parsed.error.issues[0]?.message;
      }
    }
    setErrors(nextErrors);
    setSaved(false);
    if (Object.keys(nextErrors).length > 0 || Object.keys(next).length === 0) return;

    setSaving(true);
    setFormError(undefined);
    try {
      await api<ProfileResponse>("/profile", { method: "PATCH", body: next });
      setSaved(true);
      onChanged();
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === "VALIDATION_FAILED") setErrors(fieldErrorsFrom(error));
      else setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Avatar name={profile.displayName ?? profile.email} size="lg" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-h2 break-words">{profile.displayName ?? "Your profile"}</h2>
          <p className="text-body-small text-text-secondary">Account {profile.userNumber}</p>
        </div>
      </div>

      <dl className="flex flex-col divide-y divide-border">
        <div className="flex flex-col gap-1 pb-4">
          <dt className="text-caption text-text-secondary">User ID</dt>
          <dd className="text-h3 tabular-nums">{profile.userNumber}</dd>
        </div>
        <div className="flex flex-col gap-1 pt-4">
          <dt className="text-caption text-text-secondary">Email</dt>
          <dd className="flex flex-wrap items-center gap-2 text-body break-all">
            {profile.email}
            {profile.emailVerified && (
              <Badge tone="success" icon={<CircleCheck />}>
                Verified
              </Badge>
            )}
          </dd>
        </div>
      </dl>

      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {formError && <FormAlert>{formError}</FormAlert>}
        {saved && <FormAlert tone="success">Your changes are saved.</FormAlert>}
        <Input
          label="Display name"
          hint="Shown on your account. It doesn't have to be unique."
          autoComplete="name"
          maxLength={displayNameMaxLength + 10}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          error={errors.displayName}
        />
        <Select
          label="Time zone"
          hint="Used to show times in your local time."
          options={options}
          value={timeZone}
          onChange={(event) => setTimeZone(event.target.value)}
          error={errors.timeZone}
        />
        <div className="flex justify-end">
          <Button type="submit" loading={saving} disabled={unchanged}>
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  );
}
