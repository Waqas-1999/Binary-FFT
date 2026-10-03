"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "@repo/utils";
import { IconButton } from "./icon-button.tsx";

export interface DialogProps {
  open: boolean;
  /** Called on Escape, backdrop click and the close button. */
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Actions, e.g. Cancel / Confirm buttons. */
  footer?: ReactNode;
  className?: string;
}

const shared =
  "m-0 overflow-hidden border border-border bg-surface-elevated p-0 text-text-primary shadow-overlay backdrop:bg-scrim " +
  "transition-[opacity,translate,display,overlay] transition-discrete duration-(--duration-base) ease-standard " +
  "backdrop:opacity-0 backdrop:transition-[opacity,display,overlay] backdrop:transition-discrete backdrop:duration-(--duration-base) " +
  "open:backdrop:opacity-100 starting:open:backdrop:opacity-0";

const variants = {
  dialog:
    "inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-md rounded-lg opacity-0 translate-y-2 open:opacity-100 open:translate-y-0 starting:open:opacity-0 starting:open:translate-y-2",
  sheet:
    "inset-x-0 top-auto bottom-0 mx-auto max-h-[90dvh] w-full max-w-full rounded-t-lg border-b-0 translate-y-full open:translate-y-0 starting:open:translate-y-full sm:max-w-lg",
};

function Modal({
  variant,
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps & { variant: keyof typeof variants }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      // A click on the dialog element itself (not its content) is a click on the backdrop.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={cx(shared, variants[variant], className)}
    >
      <div
        className={cx(
          "flex max-h-[inherit] flex-col",
          variant === "sheet" && "pb-[env(safe-area-inset-bottom)]",
        )}
      >
        {variant === "sheet" && (
          <span aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border-strong" />
        )}
        <div className="flex items-start gap-4 px-5 pt-4 sm:px-6 sm:pt-5">
          <div className="flex min-w-0 flex-1 flex-col gap-1 pt-2">
            <h2 id={titleId} className="text-h2">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="text-body-small text-text-secondary">
                {description}
              </p>
            )}
          </div>
          <IconButton label="Close" icon={<X />} onClick={onClose} className="-mr-2" />
        </div>
        {children && <div className="overflow-y-auto px-5 pt-4 sm:px-6">{children}</div>}
        {footer && (
          <div className="flex flex-col-reverse gap-2 px-5 pt-6 sm:flex-row sm:justify-end sm:px-6">{footer}</div>
        )}
        <div className="h-5 shrink-0 sm:h-6" />
      </div>
    </dialog>
  );
}

/** Centered modal for short decisions. Prefer BottomSheet for mobile-first choices and forms. */
export function Dialog(props: DialogProps) {
  return <Modal variant="dialog" {...props} />;
}

/** Modal that slides up from the bottom; comfortable to reach on phones. */
export function BottomSheet(props: DialogProps) {
  return <Modal variant="sheet" {...props} />;
}
