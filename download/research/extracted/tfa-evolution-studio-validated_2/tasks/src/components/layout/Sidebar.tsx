"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Projects" },
  { href: "/agents", label: "Agents" },
  { href: "/compiler", label: "Compiler" },
  { href: "/integrations", label: "Integrations" },
  { href: "/automation", label: "Automation" },
  { href: "/learning", label: "Learning" },
  { href: "/intelligence", label: "Intelligence" },
  { href: "/observability", label: "Observability" },
  { href: "/governance", label: "Governance" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col">
      <div className="px-4 py-5 border-b border-zinc-800">
        <div className="text-sm font-semibold text-zinc-100">TFA Evolution Studio</div>
        <div className="text-xs text-zinc-500 mt-0.5">Studio v32.0</div>
      </div>
      <nav className="flex-1 overflow-y-auto py-3">
        <ul className="space-y-0.5 px-2">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={[
                    "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-zinc-800 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200",
                  ].join(" ")}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="px-4 py-3 border-t border-zinc-800">
        <div className="text-xs text-zinc-600">v32.0.0</div>
      </div>
    </aside>
  );
}

export default Sidebar;
