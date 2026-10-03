import type { ReactNode } from "react";
import { cx } from "@repo/utils";

export function PageHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-h1">{title}</h1>
        {description && <p className="text-body text-text-secondary">{description}</p>}
      </div>
      {action}
    </header>
  );
}
