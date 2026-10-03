"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "@repo/utils";

export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
}

/** Accessible tabs (WAI-ARIA pattern): arrow keys move between tabs, Home/End jump to the ends. */
export function Tabs({
  items,
  label,
  defaultValue,
  value: controlled,
  onValueChange,
  className,
}: {
  items: TabItem[];
  /** Accessible name for the tab list. */
  label: string;
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}) {
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [internal, setInternal] = useState(defaultValue ?? items[0]?.value);
  const selected = controlled ?? internal;

  const select = (value: string) => {
    if (controlled === undefined) setInternal(value);
    onValueChange?.(value);
  };

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const last = items.length - 1;
    const target =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (target === null) return;

    event.preventDefault();
    const item = items[target];
    if (!item) return;
    select(item.value);
    tabRefs.current[target]?.focus();
  };

  const active = items.find((item) => item.value === selected);

  return (
    <div className={cx("flex flex-col gap-6", className)}>
      <div
        role="tablist"
        aria-label={label}
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] sm:mx-0 sm:px-0"
      >
        {items.map((item, index) => {
          const isSelected = item.value === selected;
          return (
            <button
              key={item.value}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.value}`}
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${item.value}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => select(item.value)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cx(
                "transition-control focus-ring relative -mb-px min-h-11 shrink-0 rounded-t-sm border-b-2 px-3 text-body-small whitespace-nowrap",
                isSelected
                  ? "border-brand font-semibold text-text-primary"
                  : "border-transparent font-medium text-text-secondary hover:text-text-primary",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {active && (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${active.value}`}
          aria-labelledby={`${baseId}-tab-${active.value}`}
          tabIndex={0}
          className="focus-ring rounded-sm"
        >
          {active.content}
        </div>
      )}
    </div>
  );
}
