import {
  LayoutDashboard,
  Bot,
  Play,
  Sparkles,
  Factory,
  LibraryBig,
  BrainCircuit,
  Radar,
  SatelliteDish,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  labelKey: string; // key under nav.*
  icon: LucideIcon;
  /** Shown in the mobile bottom tab bar. */
  mobile: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", labelKey: "missions", icon: LayoutDashboard, mobile: true },
  { href: "/agents", labelKey: "agents", icon: Bot, mobile: true },
  { href: "/runs", labelKey: "runs", icon: Play, mobile: true },
  { href: "/skills", labelKey: "skills", icon: Sparkles, mobile: true },
  { href: "/library", labelKey: "library", icon: LibraryBig, mobile: false },
  { href: "/memory", labelKey: "memory", icon: BrainCircuit, mobile: false },
  { href: "/operations", labelKey: "operations", icon: Radar, mobile: false },
  { href: "/sovereignty", labelKey: "sovereignty", icon: SatelliteDish, mobile: false },
  { href: "/capability-os", labelKey: "capabilityOs", icon: Factory, mobile: false },
  { href: "/settings", labelKey: "settings", icon: Settings, mobile: true },
];
