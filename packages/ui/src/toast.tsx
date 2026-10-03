"use client";

import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@repo/utils";
import { IconButton } from "./icon-button.tsx";

export type ToastTone = "success" | "error" | "warning" | "info";

export interface ToastInput {
  tone?: ToastTone;
  title: string;
  description?: string;
  /** Milliseconds before auto-dismiss. Errors stay longer by default. */
  duration?: number;
}

interface ToastEntry extends Required<Omit<ToastInput, "description">> {
  id: number;
  description?: string;
  leaving: boolean;
}

const MAX_VISIBLE = 3;
const EXIT_MS = 180; // --duration-base

const tones: Record<ToastTone, { icon: LucideIcon; className: string }> = {
  success: { icon: CircleCheck, className: "text-success" },
  error: { icon: CircleAlert, className: "text-danger" },
  warning: { icon: TriangleAlert, className: "text-warning" },
  info: { icon: Info, className: "text-info" },
};

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

/** Returns `toast({ tone, title, description })`. Requires a `ToastProvider` ancestor. */
export function useToast(): (toast: ToastInput) => void {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast must be used inside <ToastProvider>");
  return toast;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)));
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), EXIT_MS);
  }, []);

  const show = useCallback((input: ToastInput) => {
    const tone = input.tone ?? "info";
    const entry: ToastEntry = {
      id: nextId.current++,
      tone,
      title: input.title,
      description: input.description,
      duration: input.duration ?? (tone === "error" ? 8000 : 5000),
      leaving: false,
    };
    setToasts((current) => [...current, entry].slice(-MAX_VISIBLE));
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <section
        aria-label="Notifications"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 p-4 md:inset-x-auto md:top-auto md:right-0 md:bottom-0 md:items-end"
      >
        {toasts.map((toast) => (
          <ToastView key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </section>
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDismiss }: { toast: ToastEntry; onDismiss: (id: number) => void }) {
  const { icon: Icon, className } = tones[toast.tone];

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <div
      role={toast.tone === "error" ? "alert" : undefined}
      className={cx(
        "pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-md border border-border bg-surface-elevated py-3 pr-1 pl-4 shadow-overlay transition-[opacity,translate] duration-(--duration-base) ease-in",
        toast.leaving && "translate-y-1 opacity-0",
      )}
    >
      <Icon aria-hidden="true" className={cx("mt-0.5 size-5 shrink-0", className)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
        <p className="text-body-small font-semibold text-text-primary">{toast.title}</p>
        {toast.description && <p className="text-body-small text-text-secondary">{toast.description}</p>}
      </div>
      <IconButton label="Dismiss notification" icon={<X />} onClick={() => onDismiss(toast.id)} className="size-9" />
    </div>
  );
}
