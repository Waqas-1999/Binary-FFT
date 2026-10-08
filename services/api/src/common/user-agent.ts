export interface DeviceSummary {
  browser: string;
  os: string;
}

/**
 * A coarse "Chrome on Windows" summary of a User-Agent header. Deliberately not fingerprinting: no
 * versions, models or other detail that would identify one machine among many.
 */
export function summarizeUserAgent(userAgent: string | null | undefined): DeviceSummary {
  const ua = userAgent ?? "";
  // Order matters: Edge and Opera also say "Chrome"; Chrome also says "Safari".
  const browser = /\bEdg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /\bOPR\/|\bOpera\b/.test(ua)
      ? "Opera"
      : /\bFirefox\/|\bFxiOS\//.test(ua)
        ? "Firefox"
        : /\bChrome\/|\bCriOS\//.test(ua)
          ? "Chrome"
          : /\bSafari\//.test(ua)
            ? "Safari"
            : "Unknown browser";
  const os = /\bAndroid\b/.test(ua)
    ? "Android"
    : /\biPhone|\biPad|\biPod/.test(ua)
      ? "iOS"
      : /\bWindows\b/.test(ua)
        ? "Windows"
        : /\bMac OS X\b|\bMacintosh\b/.test(ua)
          ? "macOS"
          : /\bCrOS\b/.test(ua)
            ? "ChromeOS"
            : /\bLinux\b|\bX11\b/.test(ua)
              ? "Linux"
              : "Unknown device";
  return { browser, os };
}

export function deviceKey(userAgent: string | null | undefined): string {
  const { browser, os } = summarizeUserAgent(userAgent);
  return `${browser}|${os}`;
}

/** Postgres `inet` values can carry a `/32` suffix; show just the address. */
export function plainIp(ip: string | null | undefined): string | null {
  return ip ? ip.replace(/\/\d+$/, "") : null;
}
