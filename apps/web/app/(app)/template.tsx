import type { ReactNode } from "react";

/** Re-mounts on navigation, giving each page a short fade-in (removed under reduced motion). */
export default function AppTemplate({ children }: { children: ReactNode }) {
  return <div className="animate-fade-in">{children}</div>;
}
