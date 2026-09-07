/**
 * TaskComposer — the "create a task" surface. Give the agent an objective and
 * a repository and launch a real delivery run (optionally dry-run). Repo is
 * remembered locally so launching many tasks in parallel is fast. Opened from
 * the top-bar Dispatch button, ⌘K, and the Tasks board.
 */
import React, { useEffect, useRef, useState } from "react";
import { UI, FONT, Button, Pill } from "./ui.js";
import { Icon } from "./icons.js";

const REPO_KEY = "qodo:last-repo";
const OBJECTIVE_KEY = "qodo:composer:objective";

export function TaskComposer({
  open,
  busy,
  error,
  lockedRepo,
  onClose,
  onLaunch,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  /** When GitHub Live is connected the task targets that repository. */
  lockedRepo?: string | null;
  onClose: () => void;
  onLaunch: (objective: string, repo: string, dryRun: boolean) => void | Promise<void>;
}): React.ReactElement | null {
  const [objective, setObjectiveRaw] = useState("");
  const [repo, setRepo] = useState("");
  // Persist the objective draft so a half-written task survives app close.
  const setObjective = (v: string) => {
    setObjectiveRaw(v);
    try { if (v) localStorage.setItem(OBJECTIVE_KEY, v); else localStorage.removeItem(OBJECTIVE_KEY); } catch { /* ignore */ }
  };
  const [dryRun, setDryRun] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

  useEffect(() => {
    if (!open) return;
    if (lockedRepo) setRepo(lockedRepo);
    else { try { setRepo((r) => r || localStorage.getItem(REPO_KEY) || ""); } catch { /* ignore */ } }
    // Restore a previously-drafted objective.
    try { const d = localStorage.getItem(OBJECTIVE_KEY); if (d) setObjectiveRaw((o) => o || d); } catch { /* ignore */ }
    setTimeout(() => areaRef.current?.focus(), 40);
  }, [open, lockedRepo]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape" && open) onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canLaunch = objective.trim().length > 2 && /^[^/\s]+\/[^/\s]+$/.test(repo.trim()) && !busy;
  const launch = () => {
    if (!canLaunch) return;
    try { localStorage.setItem(REPO_KEY, repo.trim()); } catch { /* ignore */ }
    void onLaunch(objective.trim(), repo.trim(), dryRun);
    setObjective(""); // also clears the persisted draft
  };

  const field: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 11, fontFamily: FONT, fontSize: 14,
    background: UI.bgElevated, border: `1px solid ${UI.borderStrong}`, color: UI.textPrimary, outline: "none",
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(2,6,23,0.72)", backdropFilter: "blur(6px)", display: "grid", placeItems: "start center", paddingTop: "12vh" }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(620px, 92vw)", background: UI.bgElevated, border: `1px solid ${UI.borderStrong}`, borderRadius: 18, boxShadow: "0 30px 80px rgba(2,6,23,0.6)", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${UI.border}`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: UI.indigoLight, display: "grid", placeItems: "center" }}><Icon name="dispatch" size={18} /></span>
          <span style={{ fontSize: 15, fontWeight: 700 }}>New task</span>
          <div style={{ flex: 1 }} />
          {!coarse && <Pill color={UI.textMuted}>Esc to close</Pill>}
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={lbl}>Objective</label>
            <textarea ref={areaRef} value={objective} onChange={(e) => setObjective(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") launch(); }}
              placeholder="e.g. Add rate limiting to the public API and cover it with tests"
              rows={3} style={{ ...field, resize: "vertical", lineHeight: 1.5 }} />
          </div>
          <div>
            <label style={lbl}>Repository</label>
            <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" spellCheck={false}
              disabled={Boolean(lockedRepo)}
              style={{ ...field, fontFamily: "monospace", fontSize: 13, opacity: lockedRepo ? 0.75 : 1 }} />
            {lockedRepo && <div style={{ fontSize: 11, color: UI.textMuted, marginTop: 5 }}>Connected via GitHub Live — the run dispatches in this repository.</div>}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, color: UI.textSecondary }}>
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} style={{ cursor: "pointer" }} />
            <span><strong style={{ color: UI.textPrimary }}>Dry run</strong> — plan, code, and validate, but stop before any commit, deploy, or merge.</span>
          </label>

          {error && <div role="alert" style={{ fontSize: 12.5, color: UI.red }}>{error}</div>}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 2 }}>
            <span style={{ fontSize: 11.5, color: UI.textMuted }}>Launch many in parallel — each becomes a live task on the board.</span>
            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" color={dryRun ? UI.amber : UI.green} onClick={launch} disabled={!canLaunch}>
                {busy ? "Launching…" : dryRun ? "Launch dry run" : "Launch task"}
                {!coarse && <kbd style={{ fontFamily: FONT, fontSize: 11, opacity: 0.7, marginLeft: 2 }}>⌘↵</kbd>}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const lbl: React.CSSProperties = { display: "block", fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", fontWeight: 700, color: UI.textMuted, marginBottom: 7 };
