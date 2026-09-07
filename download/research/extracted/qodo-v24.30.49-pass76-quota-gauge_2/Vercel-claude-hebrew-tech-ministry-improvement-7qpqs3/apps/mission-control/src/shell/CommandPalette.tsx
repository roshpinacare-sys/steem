/**
 * CommandPalette — the superuser ⌘K surface. Fuzzy-search to navigate to any
 * page or run any action (new task, switch data mode, toggle autonomy, open the
 * Studio, refresh…). Fully keyboard-driven, the interaction pattern expert
 * tools (Linear, Raycast, Vercel) are built around.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { UI, FONT, Pill } from "./ui.js";
import { Icon, type IconName } from "./icons.js";

export interface Command {
  id: string;
  title: string;
  group: string;
  hint?: string;
  icon?: IconName;
  keywords?: string;
  run: () => void;
}

/** Subsequence match (each query char appears in order) + substring boost. */
function score(cmd: Command, q: string): number {
  if (!q) return 1;
  const hay = `${cmd.title} ${cmd.group} ${cmd.keywords ?? ""}`.toLowerCase();
  const needle = q.toLowerCase();
  if (hay.includes(needle)) return 100 - hay.indexOf(needle);
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length ? 1 : 0;
}

export function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}): React.ReactElement | null {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);

  const results = useMemo(() => {
    return commands
      .map((c) => ({ c, s: score(c, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }, [commands, q]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  const run = (c?: Command) => { if (c) { c.run(); onClose(); } };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); run(results[sel]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  // Group in the order groups first appear in `results`.
  const groups: string[] = [];
  for (const r of results) if (!groups.includes(r.group)) groups.push(r.group);
  let idx = -1;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(2,6,23,0.7)", backdropFilter: "blur(6px)", display: "grid", placeItems: "start center", paddingTop: "12vh" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(640px, 92vw)", background: UI.bgElevated, border: `1px solid ${UI.borderStrong}`, borderRadius: 16, boxShadow: "0 30px 80px rgba(2,6,23,0.6)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: `1px solid ${UI.border}` }}>
          <span style={{ color: UI.textMuted, display: "grid", placeItems: "center" }}><Icon name="command" size={18} /></span>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder="Search actions and pages…" spellCheck={false}
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: UI.textPrimary, fontFamily: FONT, fontSize: 15 }} />
          <Pill color={UI.textMuted}>Esc</Pill>
        </div>
        <div ref={listRef} style={{ maxHeight: 420, overflowY: "auto", padding: 8 }}>
          {results.length === 0 ? (
            <div style={{ padding: "28px 16px", textAlign: "center", color: UI.textMuted, fontSize: 13 }}>No matches.</div>
          ) : groups.map((g) => (
            <div key={g} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10.5, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700, color: UI.textMuted, padding: "8px 10px 4px" }}>{g}</div>
              {results.filter((r) => r.group === g).map((c) => {
                idx++;
                const i = idx;
                const on = i === sel;
                return (
                  <button key={c.id} data-idx={i} onMouseEnter={() => setSel(i)} onClick={() => run(c)}
                    style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", textAlign: "left", padding: "9px 10px", borderRadius: 9, border: "1px solid transparent", cursor: "pointer",
                      background: on ? UI.bgActive : "transparent", borderColor: on ? "rgba(99,102,241,0.3)" : "transparent", fontFamily: FONT }}>
                    <span style={{ color: on ? UI.indigoLight : UI.textMuted, display: "grid", placeItems: "center", width: 18 }}>{c.icon ? <Icon name={c.icon} size={16} /> : "›"}</span>
                    <span style={{ flex: 1, fontSize: 13.5, color: on ? UI.textWhite : UI.textSecondary }}>{c.title}</span>
                    {c.hint && <span style={{ fontSize: 11.5, color: UI.textMuted }}>{c.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
