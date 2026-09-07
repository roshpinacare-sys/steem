/**
 * AppMenu — the top-left application menu. Tap the logo and every destination
 * is one gesture away: identity + live source, quick actions (New task,
 * Search, Refresh), and the full navigation as expandable sub-menu groups.
 * One source of truth: it renders straight from NAV.
 */
import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { NAV, type PageId } from "./nav.js";
import { Icon } from "./icons.js";
import { UI, FONT, Dot } from "./ui.js";
import { useTelemetryCtx } from "../context/TelemetryContext.js";
import { useGitHubLive } from "./github/GitHubLiveContext.js";
import type { useMissionControl } from "./useMissionControl.js";

export interface AppMenuProps {
  open: boolean;
  onClose: () => void;
  page: PageId;
  navigate: (p: PageId) => void;
  mc: ReturnType<typeof useMissionControl>;
  conn: { label: string; color: string; glow: boolean };
  onNewTask: () => void;
  onSearch: () => void;
  /** Anchor geometry differs between the phone header and the desktop rail. */
  desktop?: boolean;
}

export function AppMenu(props: AppMenuProps): React.ReactElement {
  const { open, onClose, page, navigate, mc, conn, desktop = false } = props;
  const gh = useGitHubLive();
  const telemetry = useTelemetryCtx();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(NAV.map((g) => g.label)));
  const [refreshing, setRefreshing] = useState(false);

  // Every destination visible on open; groups stay collapsible for focus.
  useEffect(() => {
    if (open) setExpanded(new Set(NAV.map((g) => g.label)));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const go = (id: PageId) => { navigate(id); onClose(); };

  const refresh = async () => {
    setRefreshing(true);
    try {
      if (mc.source === "github") await gh.refresh();
      else await telemetry.refresh();
    } finally {
      setTimeout(() => setRefreshing(false), 400);
    }
  };

  const toggleGroup = (label: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="backdrop" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}
            style={{ position: "fixed", inset: 0, zIndex: 94, background: "rgba(2,6,23,0.5)" }} />
          <motion.div key="panel" role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            style={{
              position: "fixed", zIndex: 95,
              top: desktop ? 64 : "calc(60px + var(--sa-top))",
              left: desktop ? 12 : 10,
              ...(desktop ? { width: 300 } : { right: 10 }),
              maxHeight: "calc(100vh - 76px - var(--sa-top) - var(--sa-bottom))",
              overflowY: "auto",
              borderRadius: 16,
              background: UI.bgElevated,
              backdropFilter: "blur(16px)",
              border: `1px solid ${UI.borderStrong}`,
              boxShadow: "0 18px 50px rgba(0,0,0,0.5)",
              padding: "12px 10px calc(12px + var(--sa-bottom))",
              fontFamily: FONT,
            }}>
            {/* Identity + source */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 12px" }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: `linear-gradient(135deg, ${UI.indigo}, ${UI.purple})`, display: "grid", placeItems: "center" }}>
                <Icon name="bolt" size={16} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: UI.textWhite }}>Qodo V24</div>
                <div style={{ fontSize: 10.5, color: UI.textMuted }}>Mission Control</div>
              </div>
              <button onClick={() => go("connections")}
                style={{ display: "flex", alignItems: "center", gap: 6, background: UI.bgPanel, border: `1px solid ${UI.border}`, borderRadius: 999, padding: "5px 10px", cursor: "pointer" }}>
                <Dot color={conn.color} glow={conn.glow} size={6} />
                <span style={{ fontSize: 10.5, fontWeight: 600, color: UI.textSecondary, whiteSpace: "nowrap" }}>{conn.label}</span>
              </button>
            </div>

            {/* Quick actions */}
            <div style={{ display: "flex", gap: 8, padding: "0 4px 12px" }}>
              <QuickAction icon="dispatch" label="New task" accent={UI.indigo} onClick={() => { props.onNewTask(); onClose(); }} />
              <QuickAction icon="command" label="Search" onClick={() => { props.onSearch(); onClose(); }} />
              <QuickAction icon="refresh" label={refreshing ? "Syncing…" : "Refresh"} onClick={() => void refresh()} spinning={refreshing} />
            </div>

            {/* Nav groups with expandable sub-menus */}
            {NAV.map((group) => {
              const isOpen = expanded.has(group.label);
              return (
                <div key={group.label} style={{ marginBottom: 4 }}>
                  <button onClick={() => toggleGroup(group.label)} aria-expanded={isOpen}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", minHeight: 40, padding: "6px 10px", background: "none", border: "none", cursor: "pointer", fontFamily: FONT }}>
                    <span style={{ flex: 1, textAlign: "left", fontSize: 10.5, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700, color: UI.textMuted }}>{group.label}</span>
                    <span style={{ fontSize: 10, color: UI.textMuted, fontVariantNumeric: "tabular-nums" }}>{group.items.length}</span>
                    <motion.span animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.15 }} style={{ color: UI.textMuted, display: "grid", placeItems: "center" }}>
                      <Icon name="chevron" size={13} />
                    </motion.span>
                  </button>
                  <motion.div initial={false} animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
                    transition={{ duration: 0.18, ease: "easeOut" }} style={{ overflow: "hidden" }}>
                    {group.items.map((item) => {
                      const active = item.id === page;
                      return (
                        <button key={item.id} role="menuitem" onClick={() => go(item.id)}
                          style={{
                            display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 44, padding: "10px 10px",
                            borderRadius: 10, border: "1px solid transparent", cursor: "pointer", textAlign: "left", fontFamily: FONT,
                            fontSize: 14, fontWeight: active ? 650 : 500,
                            color: active ? UI.textWhite : UI.textSecondary,
                            background: active ? UI.bgActive : "transparent",
                          }}>
                          <span style={{ color: active ? UI.indigoLight : UI.textMuted, display: "grid", placeItems: "center", flexShrink: 0 }}>
                            <Icon name={item.icon} size={18} />
                          </span>
                          {item.label}
                        </button>
                      );
                    })}
                  </motion.div>
                </div>
              );
            })}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function QuickAction({ icon, label, onClick, accent, spinning }: { icon: "dispatch" | "command" | "refresh"; label: string; onClick: () => void; accent?: string; spinning?: boolean }): React.ReactElement {
  return (
    <button onClick={onClick}
      style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, minHeight: 52,
        padding: "9px 4px", borderRadius: 12, cursor: "pointer", fontFamily: FONT,
        background: accent ? `${accent}1e` : UI.bgPanel,
        border: `1px solid ${accent ? `${accent}44` : UI.border}`,
        color: accent ? UI.indigoLight : UI.textSecondary,
      }}>
      <motion.span animate={spinning ? { rotate: 360 } : { rotate: 0 }}
        transition={spinning ? { repeat: Infinity, duration: 0.9, ease: "linear" } : { duration: 0 }}
        style={{ display: "grid", placeItems: "center" }}>
        <Icon name={icon} size={17} />
      </motion.span>
      <span style={{ fontSize: 10.5, fontWeight: 600 }}>{label}</span>
    </button>
  );
}
