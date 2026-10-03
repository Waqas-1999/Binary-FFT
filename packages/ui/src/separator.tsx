import { cx } from "@repo/utils";

/** A visual or semantic boundary between content. Decorative by default. */
export function Separator({
  orientation = "horizontal",
  decorative = true,
  className,
}: {
  orientation?: "horizontal" | "vertical";
  decorative?: boolean;
  className?: string;
}) {
  return (
    <div
      role={decorative ? "none" : "separator"}
      aria-orientation={decorative ? undefined : orientation}
      className={cx("shrink-0 bg-border", orientation === "horizontal" ? "h-px w-full" : "w-px self-stretch", className)}
    />
  );
}

/** Horizontal divider between sections, optionally with a short label such as "or". */
export function Divider({ label, className }: { label?: string; className?: string }) {
  if (!label) return <Separator decorative={false} className={className} />;

  return (
    <div role="separator" className={cx("flex items-center gap-3 text-caption text-text-muted", className)}>
      <span className="h-px flex-1 bg-border" />
      {label}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
