"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** "center" = dialog, "end" = side sheet (mobile-friendly). */
  variant?: "center" | "sheet";
  className?: string;
  labelledBy?: string;
}

export function Modal({
  open,
  onClose,
  children,
  variant = "center",
  className,
  labelledBy,
}: ModalProps) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-up"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative z-10 m-auto flex max-h-[92vh] w-full flex-col overflow-hidden bg-surface shadow-2xl animate-fade-up",
          variant === "center"
            ? "max-w-lg rounded-xl border border-border sm:max-h-[88vh]"
            : "ms-auto h-full max-w-md border-s border-border",
          className,
        )}
      >
        <button
          onClick={onClose}
          className="absolute end-3 top-3 z-20 rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ModalHeader({
  title,
  description,
  id,
}: {
  title: string;
  description?: string;
  id?: string;
}) {
  return (
    <div className="border-b border-border p-5 pe-12">
      <h2 id={id} className="font-display text-lg font-semibold text-foreground">
        {title}
      </h2>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

export function ModalBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex-1 overflow-y-auto p-5", className)} {...props} />
  );
}

export function ModalFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 border-t border-border p-4",
        className,
      )}
      {...props}
    />
  );
}
