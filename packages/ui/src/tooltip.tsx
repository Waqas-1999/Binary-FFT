import { cloneElement, useId, type ReactElement } from "react";
import { cx } from "@repo/utils";

/**
 * Supplementary hint shown on hover and keyboard focus (CSS only, no JavaScript).
 * Never put essential information in a tooltip: touch devices have no hover.
 */
export function Tooltip({
  content,
  side = "top",
  children,
}: {
  content: string;
  side?: "top" | "bottom";
  /** A single focusable element; it receives `aria-describedby`. */
  children: ReactElement<{ "aria-describedby"?: string }>;
}) {
  const id = useId();
  return (
    <span className="group/tooltip relative inline-flex">
      {cloneElement(children, { "aria-describedby": id })}
      <span
        role="tooltip"
        id={id}
        className={cx(
          "pointer-events-none absolute left-1/2 z-50 w-max max-w-60 -translate-x-1/2 rounded-sm bg-text-primary px-2.5 py-1.5 text-caption font-medium text-background opacity-0 shadow-overlay transition-opacity duration-(--duration-fast) group-hover/tooltip:opacity-100 group-hover/tooltip:delay-300 group-focus-within/tooltip:opacity-100",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
        )}
      >
        {content}
      </span>
    </span>
  );
}
