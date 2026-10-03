import { CircleAlert, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "@repo/utils";

interface StateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  /** The next step, e.g. a button or link. */
  action?: ReactNode;
  className?: string;
}

function StateLayout({ icon, title, description, action, className, role }: StateProps & { role?: "alert" }) {
  return (
    <div role={role} className={cx("flex flex-col items-center gap-4 px-4 py-12 text-center", className)}>
      {icon && (
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-full bg-surface-muted text-text-secondary [&>svg]:size-6"
        >
          {icon}
        </span>
      )}
      <div className="flex max-w-sm flex-col gap-1">
        <h2 className="text-h2">{title}</h2>
        {description && <p className="text-body-small text-text-secondary">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Explains what will appear here and offers the next step. */
export function EmptyState(props: StateProps) {
  return <StateLayout {...props} />;
}

/**
 * User-friendly error with an optional retry action. Never pass raw technical messages here;
 * log those for developers instead.
 */
export function ErrorState({
  kind = "generic",
  title,
  description,
  ...props
}: Partial<StateProps> & { kind?: "generic" | "network" }) {
  const network = kind === "network";
  return (
    <StateLayout
      role="alert"
      icon={network ? <WifiOff /> : <CircleAlert />}
      title={title ?? (network ? "Can't connect right now" : "Something went wrong")}
      description={
        description ?? (network ? "Check your internet connection and try again." : "Please try again in a moment.")
      }
      {...props}
    />
  );
}
