import { createHash, randomBytes } from "node:crypto";

/** 256-bit random token, base64url-encoded (43 characters). Sent to the client once; never stored. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex digest stored in place of the token. Fast hashing is fine for 256-bit random input. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
