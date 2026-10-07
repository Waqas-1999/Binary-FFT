"use client";

import type { z } from "@repo/validation";
import { CircleAlert, CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import { ApiRequestError } from "../../lib/api";

export type FieldErrors = Partial<Record<string, string>>;

/** First message per field, from a failed zod parse or from the API's validation issues. */
export function fieldErrorsFrom(source: z.ZodError | ApiRequestError): FieldErrors {
  const issues =
    source instanceof ApiRequestError
      ? (source.issues ?? [])
      : source.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));

  const errors: FieldErrors = {};
  for (const { path, message } of issues) errors[path] ??= message;
  return errors;
}

/** Form-level message, announced to screen readers. */
export function FormAlert({ tone = "error", children }: { tone?: "error" | "success"; children: ReactNode }) {
  const Icon = tone === "error" ? CircleAlert : CircleCheck;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "flex items-start gap-2.5 rounded-md bg-danger/10 px-3.5 py-3 text-body-small text-danger-text"
          : "flex items-start gap-2.5 rounded-md bg-success/10 px-3.5 py-3 text-body-small text-success-text"
      }
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function AuthHeading({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="text-h1">{title}</h1>
      {description && <p className="text-body-small text-text-secondary">{description}</p>}
    </div>
  );
}
