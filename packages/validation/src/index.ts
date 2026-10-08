import { z } from "zod";
import type { ValidationIssue } from "@repo/types";

// Re-exported so every workspace uses the same zod instance and version.
export { z };

export function toValidationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export * from "./auth.ts";

export * from "./profile.ts";
