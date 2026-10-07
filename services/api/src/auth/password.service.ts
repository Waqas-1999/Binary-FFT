import { Injectable } from "@nestjs/common";
import { hash, verify } from "@node-rs/argon2";
import { authConfig } from "./auth.config.ts";

// `Algorithm.Argon2id` from @node-rs/argon2 is an ambient const enum, which isolatedModules can't import.
const ARGON2ID = 2;
const options = { algorithm: ARGON2ID, ...authConfig.argon2 };

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password, options);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /**
   * Spends the same time as a real verification so responses for unknown emails
   * can't be told apart by timing. Always returns false.
   */
  async verifyAgainstDummy(password: string): Promise<false> {
    this.dummyHash ??= hash("dummy-password-for-timing", options);
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
