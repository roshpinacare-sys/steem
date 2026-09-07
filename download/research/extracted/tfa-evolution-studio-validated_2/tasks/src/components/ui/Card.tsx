"use client";

import { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = "" }: CardProps) {
  return (
    <div
      className={[
        "rounded-lg border border-zinc-800 bg-zinc-900/50",
        "shadow-sm",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}
