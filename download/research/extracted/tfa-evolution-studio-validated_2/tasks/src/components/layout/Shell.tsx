"use client";

import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";

interface ShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function Shell({ title, subtitle, children }: ShellProps) {
  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-zinc-100">{title}</h1>
            {subtitle && <p className="text-sm text-zinc-400 mt-1">{subtitle}</p>}
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
