import { randomInt } from "node:crypto";
import { hashToken } from "../tokens.ts";

export const RECOVERY_CODE_COUNT = 10;

/** 32 symbols without 0/O/1/I, so codes survive being read aloud or copied by hand. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 16;

/** Cryptographically random 80-bit code, formatted `xxxx-xxxx-xxxx-xxxx`. `randomInt` is unbiased. */
export function generateRecoveryCode(): string {
  const chars = Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return chars.match(/.{4}/g)!.join("-");
}

export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateRecoveryCode());
  return [...codes];
}

/** Hash stored in place of the code. Input is already normalized by `recoveryCodeSchema`. */
export function hashRecoveryCode(normalized: string): string {
  return hashToken(`recovery:${normalized}`);
}
