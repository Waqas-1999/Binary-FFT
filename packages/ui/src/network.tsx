"use client";

import { WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cx } from "@repo/utils";

/** Connection states a future realtime layer will report. */
export type ConnectionState = "connected" | "reconnecting" | "offline";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Browser network status. Assumes online during server rendering. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

const states: Record<ConnectionState, { label: string; dot: string }> = {
  connected: { label: "Connected", dot: "bg-success" },
  reconnecting: { label: "Reconnecting…", dot: "bg-warning animate-pulse" },
  offline: { label: "Offline", dot: "bg-danger" },
};

/** Compact connection indicator. The text label carries the meaning; the dot is supplementary. */
export function ConnectionStatus({ state, className }: { state: ConnectionState; className?: string }) {
  const { label, dot } = states[state];
  return (
    <span
      role="status"
      className={cx("inline-flex items-center gap-2 text-caption font-medium text-text-secondary", className)}
    >
      <span aria-hidden="true" className={cx("size-2 rounded-full", dot)} />
      {label}
    </span>
  );
}

/** App-wide banner shown while the browser is offline. */
export function OfflineBanner() {
  const online = useOnlineStatus();

  return (
    <div role="status" aria-live="polite">
      {!online && (
        <div className="flex items-center justify-center gap-2 bg-warning/14 px-4 py-2 text-body-small font-medium text-text-primary">
          <WifiOff aria-hidden="true" className="size-4 shrink-0 text-warning" />
          You&apos;re offline. We&apos;ll reconnect automatically.
        </div>
      )}
    </div>
  );
}
