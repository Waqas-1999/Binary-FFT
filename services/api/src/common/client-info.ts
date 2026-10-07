import type { Request } from "express";

/** Request metadata stored with sessions and security events. */
export interface ClientInfo {
  /** Client IP; respects the configured trusted proxies. */
  ip: string | undefined;
  userAgent: string | undefined;
}

export function clientInfo(req: Request): ClientInfo {
  return {
    ip: req.ip,
    userAgent: req.header("user-agent")?.slice(0, 512),
  };
}

/** Reads one cookie from the Cookie header without a parsing dependency. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.header("cookie");
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
