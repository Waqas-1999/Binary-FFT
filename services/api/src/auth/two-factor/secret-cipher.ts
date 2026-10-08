import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Authenticated encryption for TOTP secrets: AES-256-GCM with a fresh random 96-bit IV per value.
 * The user id is bound in as additional authenticated data, so a ciphertext copied to another user's
 * row fails to decrypt. Stored as `v<keyVersion>.<iv>.<tag>.<ciphertext>` (base64url); the version
 * prefix lets a future key rotation tell old and new values apart.
 */
const KEY_VERSION = 1;
const IV_BYTES = 12;

export class SecretCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("Encryption key must be 32 bytes");
  }

  encrypt(plaintext: string, context: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return [`v${KEY_VERSION}`, iv, cipher.getAuthTag(), ciphertext].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
  }

  /** Throws if the value was tampered with, belongs to another context, or was encrypted with another key. */
  decrypt(stored: string, context: string): string {
    const [version, iv, tag, ciphertext, ...extra] = stored.split(".");
    if (version !== `v${KEY_VERSION}` || !iv || !tag || !ciphertext || extra.length > 0) {
      throw new Error("Unsupported encrypted value");
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  }
}
