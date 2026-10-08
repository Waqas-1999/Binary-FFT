import { Injectable } from "@nestjs/common";
import type { OAuthProvider } from "../../generated/prisma/client.js";
import { RedisService } from "../../redis/redis.service.ts";
import { authConfig } from "../auth.config.ts";
import { generateToken, hashToken } from "../tokens.ts";

/** What a started OAuth flow wants to do when Google redirects back. */
export type OAuthPurpose = "login" | "link" | "reauth";

/** Server-side context of one OAuth attempt. Never sent to the browser. */
export interface OAuthFlow {
  provider: OAuthProvider;
  purpose: OAuthPurpose;
  /** The signed-in user who started a link flow; null for sign-in. */
  userId: string | null;
  /** PKCE verifier; the matching challenge went to Google. */
  codeVerifier: string;
  /** Must come back unchanged inside Google's ID token. */
  nonce: string;
  /** Allowlisted internal path to land on after sign-in. */
  returnTo: string;
  /** SHA-256 of the cookie value that ties this flow to the browser that started it. */
  bindingHash: string;
}

export interface StartedOAuthFlow {
  /** Goes to Google as the `state` parameter. */
  state: string;
  /** Goes to the browser in an HttpOnly cookie; the callback must present it. */
  binding: string;
  codeVerifier: string;
  nonce: string;
}

const KEY_PREFIX = "oauth:state:";

/**
 * Short-lived, single-use OAuth state in Redis. Only the hash of the state is a key, so a Redis
 * dump does not reveal values that are still redeemable. Consuming is one atomic GETDEL, so a
 * replayed or concurrent callback cannot use the same state twice. Redis errors propagate and
 * the callers fail closed.
 */
@Injectable()
export class OAuthStateService {
  constructor(private readonly redis: RedisService) {}

  async start(flow: Pick<OAuthFlow, "provider" | "purpose" | "userId" | "returnTo">): Promise<StartedOAuthFlow> {
    const state = generateToken();
    const binding = generateToken();
    const codeVerifier = generateToken();
    const nonce = generateToken();
    const stored: OAuthFlow = { ...flow, codeVerifier, nonce, bindingHash: hashToken(binding) };
    await this.redis.client.set(
      KEY_PREFIX + hashToken(state),
      JSON.stringify(stored),
      "EX",
      authConfig.oAuthStateTtlSeconds,
    );
    return { state, binding, codeVerifier, nonce };
  }

  /**
   * Returns the flow for a state if it exists, has not expired or been used, and was started by the
   * browser presenting `binding`. The state is consumed even when the binding does not match, so a
   * leaked state value cannot be retried.
   */
  async consume(state: string, binding: string | undefined): Promise<OAuthFlow | null> {
    const raw = await this.redis.client.getdel(KEY_PREFIX + hashToken(state));
    if (!raw || !binding) return null;

    const flow = JSON.parse(raw) as OAuthFlow;
    return flow.bindingHash === hashToken(binding) ? flow : null;
  }
}
