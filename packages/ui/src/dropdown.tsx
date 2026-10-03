"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "@repo/utils";
import { buttonStyles, type ButtonVariant } from "./button.tsx";

export interface DropdownItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Menu button (WAI-ARIA pattern) for a short list of actions. Use Select for choosing a value. */
export function Dropdown({
  label,
  icon,
  iconOnly = false,
  items,
  align = "start",
  variant = "secondary",
}: {
  /** Trigger text; the accessible name when `iconOnly`. */
  label: string;
  icon?: ReactNode;
  iconOnly?: boolean;
  items: DropdownItem[];
  align?: "start" | "end";
  variant?: ButtonVariant;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const enabledIndexes = items.flatMap((item, index) => (item.disabled ? [] : [index]));
  const focusItem = (index: number | undefined) => {
    if (index !== undefined) itemRefs.current[index]?.focus();
  };

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    focusItem(enabledIndexes[0]);
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
    // Focus the first item only when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const position = enabledIndexes.indexOf(itemRefs.current.findIndex((item) => item === document.activeElement));
    const last = enabledIndexes.length - 1;
    const next =
      event.key === "ArrowDown" ? (position >= last ? 0 : position + 1)
      : event.key === "ArrowUp" ? (position <= 0 ? last : position - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;

    if (next !== null) {
      event.preventDefault();
      focusItem(enabledIndexes[next]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={iconOnly ? label : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={cx(buttonStyles({ variant }), iconOnly && "w-11 px-0")}
      >
        {icon && (
          <span aria-hidden="true" className="inline-flex [&>svg]:size-4.5">
            {icon}
          </span>
        )}
        {!iconOnly && (
          <>
            {label}
            <ChevronDown
              aria-hidden="true"
              className={cx("size-4 transition-transform duration-(--duration-fast)", open && "rotate-180")}
            />
          </>
        )}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={cx(
            "absolute top-full z-40 mt-2 flex min-w-48 flex-col rounded-md border border-border bg-surface-elevated p-1 shadow-overlay",
            "origin-top transition-[opacity,scale] duration-(--duration-fast) ease-out starting:scale-95 starting:opacity-0",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
              className={cx(
                "transition-control flex min-h-11 items-center gap-3 rounded-sm px-3 text-left text-body-small font-medium outline-none focus:bg-surface-muted enabled:hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50",
                item.danger ? "text-danger-text" : "text-text-primary",
              )}
            >
              {item.icon && (
                <span aria-hidden="true" className="inline-flex text-current [&>svg]:size-4.5">
                  {item.icon}
                </span>
              )}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
