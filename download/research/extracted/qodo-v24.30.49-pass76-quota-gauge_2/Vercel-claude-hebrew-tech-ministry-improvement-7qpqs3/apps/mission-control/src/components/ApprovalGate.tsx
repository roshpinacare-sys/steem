import React, { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { TelemetryEvent } from "../types/telemetry.js";
import { useTelemetryCtx } from "../context/TelemetryContext.js";
import { glassPanel, sectionLabel, FilePill, formatTime, COLOR } from "../utils/styles.js";

interface ApprovalGateProps {
  mentorMode: boolean;
  runId: string | null;
  dismissedAt: string | null;
  onApprove: (runId: string) => void;
  onReject: (runId: string, reason: string) => void;
}

interface PatchFile {
  path: string;
  content?: string;
}

export const ApprovalGate = React.memo(function ApprovalGate({
  mentorMode,
  runId,
  dismissedAt,
  onApprove,
  onReject,
}: ApprovalGateProps) {
  const [rejectReason, setRejectReason] = useState("");
  const [showReason,   setShowReason]   = useState(false);
  const { events } = useTelemetryCtx();

  const { isPending, patchEvent, planEvent, gateEvent } = useMemo(() => {
    if (!mentorMode || !runId) {
      return { isPending: false, patchEvent: null, planEvent: null, gateEvent: null };
    }
    const runEvents = events
      .filter((e) => e.runId === runId)
      .sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp));
    const latest = runEvents[runEvents.length - 1] ?? null;
    if (!latest || latest.phase !== "gate") {
      return { isPending: false, patchEvent: null, planEvent: null, gateEvent: null };
    }
    if (dismissedAt && +new Date(latest.timestamp) <= +new Date(dismissedAt)) {
      return { isPending: false, patchEvent: null, planEvent: null, gateEvent: null };
    }
    const patch = runEvents
      .filter((e) => e.phase === "coder" && e.decision === "patch-generated")
      .pop() as (TelemetryEvent & { diff?: string; files?: PatchFile[] }) | undefined;
    const plan = runEvents
      .filter((e) => e.phase === "architect" && e.decision === "plan-generated")
      .pop() as (TelemetryEvent & { steps?: { description?: string; files?: string[] }[] }) | undefined;
    return { isPending: true, patchEvent: patch ?? null, planEvent: plan ?? null, gateEvent: latest };
  }, [mentorMode, runId, events, dismissedAt]);

  if (!isPending) return null;

  const files     = patchEvent?.files ?? [];
  const diff      = patchEvent?.diff ?? "// No diff available";
  const reasoning = planEvent?.steps
    ? planEvent.steps
        .map(
          (s, i) =>
            `${i + 1}. ${s.description ?? "Unnamed step"} (${(s.files ?? []).join(", ") || "no files"})`,
        )
        .join("\n")
    : "No plan explanation available.";

  const cardStyle: React.CSSProperties = {
    padding: 16,
    borderRadius: 12,
    background: "rgba(15,23,42,0.45)",
    border: `1px solid rgba(148,163,184,0.12)`,
  };

  return (
    <AnimatePresence>
      <motion.div
        key="approval-gate"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label="Mentor Approval Gate"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(2,6,23,0.75)",
          backdropFilter: "blur(6px)",
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <motion.div
          initial={{ scale: 0.92, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.92, y: 20 }}
          transition={{ duration: 0.25 }}
          style={{
            ...glassPanel(),
            width: "100%",
            maxWidth: 760,
            maxHeight: "90vh",
            overflow: "auto",
            padding: 28,
            borderColor: COLOR.borderAmber,
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 18,
            }}
          >
            <div>
              <div
                style={{
                  ...sectionLabel(),
                  color: COLOR.amber,
                  marginBottom: 4,
                }}
              >
                Mentor Gate
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: COLOR.textPrimary }}>
                Approve Ghost Commit for {runId}
              </div>
            </div>
            <div style={{ fontSize: 12, color: COLOR.textMuted }}>
              Gate at {gateEvent ? formatTime(gateEvent.timestamp) : "—"}
            </div>
          </div>

          {/* Content cards */}
          <div style={{ display: "grid", gap: 16, marginBottom: 20 }}>
            {/* AI Reasoning */}
            <div style={cardStyle}>
              <div style={{ ...sectionLabel(), marginBottom: 8 }}>AI Reasoning</div>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  fontFamily: "inherit",
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: COLOR.textSecondary,
                }}
              >
                {reasoning}
              </pre>
            </div>

            {/* Changed files */}
            <div style={cardStyle}>
              <div style={{ ...sectionLabel(), marginBottom: 8 }}>Changed Files</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {files.length ? (
                  files.map((f, i) => <FilePill key={i} path={f.path} />)
                ) : (
                  <span style={{ fontSize: 12, color: COLOR.textMuted }}>
                    No file metadata.
                  </span>
                )}
              </div>
            </div>

            {/* Unified diff */}
            <div
              style={{
                ...cardStyle,
                background: COLOR.bgPanelDark,
              }}
            >
              <div style={{ ...sectionLabel(), marginBottom: 8 }}>Unified Diff</div>
              <pre
                style={{
                  margin: 0,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: COLOR.textSecondary,
                  maxHeight: 280,
                  overflow: "auto",
                }}
              >
                {diff}
              </pre>
            </div>
          </div>

          {/* Rejection reason textarea */}
          {showReason && (
            <div style={{ marginBottom: 16 }}>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Why are you rejecting this change?"
                aria-label="Rejection reason"
                style={{
                  width: "100%",
                  minHeight: 80,
                  padding: 12,
                  borderRadius: 10,
                  border: `1px solid ${COLOR.borderRed}`,
                  background: COLOR.bgPanel,
                  color: COLOR.textPrimary,
                  fontFamily: "inherit",
                  fontSize: 13,
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
            {!showReason ? (
              <button
                onClick={() => setShowReason(true)}
                style={btnStyle("red")}
              >
                Reject &amp; Regenerate
              </button>
            ) : (
              <>
                <button
                  onClick={() => { setShowReason(false); setRejectReason(""); }}
                  style={btnStyle("neutral")}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (runId && rejectReason.trim()) {
                      onReject(runId, rejectReason.trim());
                      setShowReason(false);
                      setRejectReason("");
                    }
                  }}
                  disabled={!rejectReason.trim()}
                  style={{
                    ...btnStyle("red"),
                    opacity: rejectReason.trim() ? 1 : 0.5,
                    cursor: rejectReason.trim() ? "pointer" : "not-allowed",
                  }}
                >
                  Confirm Rejection
                </button>
              </>
            )}
            <button
              onClick={() => runId && onApprove(runId)}
              style={btnStyle("green")}
            >
              Approve Ghost Commit
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
});

// ── Button style helper ───────────────────────────────────────────────────
type BtnVariant = "green" | "red" | "neutral";

function btnStyle(variant: BtnVariant): React.CSSProperties {
  const map: Record<BtnVariant, { border: string; bg: string; color: string }> = {
    green:   { border: COLOR.borderGreen,   bg: "rgba(52,211,153,0.12)",  color: COLOR.green },
    red:     { border: COLOR.borderRed,     bg: "rgba(248,113,113,0.12)", color: COLOR.red },
    neutral: { border: COLOR.borderSubtle,  bg: "transparent",             color: COLOR.textMuted },
  };
  const v = map[variant];
  return {
    padding: "10px 18px",
    borderRadius: 10,
    border: `1px solid ${v.border}`,
    background: v.bg,
    color: v.color,
    fontWeight: 600,
    cursor: "pointer",
  };
}
