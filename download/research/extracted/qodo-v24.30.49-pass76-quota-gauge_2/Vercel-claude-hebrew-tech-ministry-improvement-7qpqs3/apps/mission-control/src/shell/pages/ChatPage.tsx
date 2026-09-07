/**
 * ChatPage — the central console. Talk to the app in plain language (the agent
 * reads code, searches, checks runs, and acts with your confirmation) or type
 * commands that execute real operations. Works keyless; gets an AI brain the
 * moment you connect a model. Conversation persists on-device.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UI, FONT, MONO } from "../ui.js";
import { Icon } from "../icons.js";
import { respond, COMMAND_HINTS, SKILLS, type ChatTurn, type AgentStep } from "../chat/engine.js";
import { loadHistory, saveHistory, clearHistory } from "../chat/history.js";
import { hasAnyLlm, getSelected, onLlmChange } from "../llm/store.js";
import { providerById } from "../llm/providers.js";
import { getGitHubConfig } from "../github/config.js";
import { loadStr, saveStr, onAppHide } from "../../utils/persist.js";
import type { PageProps } from "../PlatformShell.js";

const DRAFT_KEY = "qodo:chat:draft";

const QUICK = ["status", "runs", "prs", "search "];

function greeting(): ChatTurn {
  const cfg = getGitHubConfig();
  const llm = hasAnyLlm();
  const where = cfg ? `connected to \`${cfg.owner}/${cfg.repo}\`` : "not connected to a repo yet";
  return {
    role: "assistant",
    content: [
      `Hi — I'm your Mission Control agent. You're ${where}.`,
      llm ? "An AI model is connected, so talk to me naturally — I can read files, search code, check runs, and act (dispatch or commit) after you confirm. Commands still work too." : "No AI model yet — I run **commands** now (type `help`). Add a model in Settings → AI providers and I become an agent that reads your code and acts.",
      "Try `status`, `runs`, `search <query>`, or `task <objective>`.",
    ].join("\n\n"),
  };
}

interface ConfirmReq { summary: string; resolve: (ok: boolean) => void }

export function ChatPage({ navigate }: PageProps): React.ReactElement {
  const [turns, setTurns] = useState<ChatTurn[]>(() => { const h = loadHistory(); return h.length ? h : [greeting()]; });
  const [input, setInput] = useState(() => loadStr(DRAFT_KEY));
  const [busy, setBusy] = useState(false);
  const [liveStep, setLiveStep] = useState<string | null>(null);
  const [confirmReq, setConfirmReq] = useState<ConfirmReq | null>(null);
  const [, force] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef(input);
  inputRef.current = input;

  useEffect(() => onLlmChange(() => force((n) => n + 1)), []);
  useEffect(() => { saveHistory(turns); }, [turns]);
  // Persist the unsent draft so it survives backgrounding / app close.
  useEffect(() => { saveStr(DRAFT_KEY, input); }, [input]);
  useEffect(() => onAppHide(() => saveStr(DRAFT_KEY, inputRef.current)), []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [turns, busy, liveStep]);

  const selected = getSelected();
  const providerLabel = selected ? providerById(selected)?.label : null;

  const confirm = useCallback((summary: string) => new Promise<boolean>((resolve) => setConfirmReq({ summary, resolve })), []);

  const send = useCallback(async (text: string) => {
    const msg = text.trim();
    if (!msg || busy) return;
    const history = turns;
    setTurns((t) => [...t, { role: "user", content: msg }]);
    setInput("");
    setBusy(true);
    setLiveStep(null);
    try {
      const reply = await respond(msg, history, {
        navigate,
        confirm,
        onStep: (s: AgentStep) => setLiveStep(`${s.ok ? "✓" : "✕"} ${s.tool}`),
      });
      setTurns((t) => [...t, reply]);
    } finally {
      setBusy(false);
      setLiveStep(null);
    }
  }, [busy, turns, navigate, confirm]);

  const newChat = () => { clearHistory(); setTurns([greeting()]); setInput(""); };

  // Slash-command menu
  const slashMatches = useMemo(() => {
    if (!input.startsWith("/")) return [];
    const q = input.slice(1).toLowerCase();
    return COMMAND_HINTS.filter((c) => c.cmd.toLowerCase().startsWith(q)).slice(0, 6);
  }, [input]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, fontFamily: FONT }}>
      {/* Sub-header: agent status + new chat */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderBottom: `1px solid ${UI.border}`, background: UI.bg }}>
        <Icon name="chat" size={15} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: UI.textSecondary }}>
          {providerLabel ? <>Agent · {providerLabel}</> : "Command console"}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={newChat} style={{ display: "flex", alignItems: "center", gap: 5, background: UI.bgPanel, border: `1px solid ${UI.border}`, borderRadius: 8, padding: "5px 10px", cursor: "pointer", color: UI.textSecondary, fontFamily: FONT, fontSize: 12 }}>
          <Icon name="refresh" size={12} /> New
        </button>
      </div>

      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 16px 8px" }}>
        <div style={{ maxWidth: 780, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {turns.map((t, i) => <Bubble key={i} turn={t} />)}
          {busy && <Bubble turn={{ role: "assistant", content: liveStep ? `Working… ${liveStep}` : "…", soft: true }} typing />}
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${UI.border}`, background: UI.bg, padding: "10px 14px calc(10px + var(--sa-bottom, 0px))" }}>
        <div style={{ maxWidth: 780, margin: "0 auto", position: "relative" }}>
          {slashMatches.length > 0 && (
            <div style={{ position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 8, background: UI.bgElevated, border: `1px solid ${UI.borderStrong}`, borderRadius: 12, overflow: "hidden", boxShadow: "0 12px 30px rgba(0,0,0,0.5)" }}>
              {slashMatches.map((m) => (
                <button key={m.cmd} onClick={() => setInput("/" + m.cmd)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 12px", background: "none", border: "none", borderBottom: `1px solid ${UI.border}`, cursor: "pointer", textAlign: "left", fontFamily: FONT }}>
                  <code style={{ fontFamily: MONO, fontSize: 12.5, color: UI.indigoLight }}>/{m.cmd.trim()}</code>
                  <span style={{ fontSize: 11.5, color: UI.textMuted }}>{m.hint}</span>
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: UI.textMuted, marginRight: 2 }}>Skills</span>
            {SKILLS.map((s) => (
              <button key={s.id} title={s.hint} disabled={busy}
                onClick={() => { if (s.arg) setInput(s.id + " "); else void send(s.id); }}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 999, cursor: "pointer", fontFamily: FONT, fontSize: 12, fontWeight: 600,
                  color: UI.indigoLight, background: "rgba(99,102,241,0.12)", border: `1px solid rgba(99,102,241,0.3)` }}>
                <Icon name="bolt" size={11} /> {s.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            {QUICK.map((q) => (
              <button key={q} onClick={() => { if (q.endsWith(" ")) setInput(q); else void send(q); }} disabled={busy} style={{
                padding: "5px 11px", borderRadius: 999, cursor: "pointer", fontFamily: MONO, fontSize: 12,
                color: UI.textSecondary, background: UI.bgPanel, border: `1px solid ${UI.border}` }}>{q.trim()}</button>
            ))}
            <div style={{ flex: 1 }} />
            {!providerLabel && <button onClick={() => navigate("settings")} style={{ background: "none", border: "none", color: UI.indigoLight, cursor: "pointer", fontSize: 11.5, fontFamily: FONT, alignSelf: "center" }}>+ add AI model</button>}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
              placeholder={hasAnyLlm() ? "Ask anything, or / for commands…" : "Type a command (help, status, runs)…"}
              rows={1} spellCheck
              style={{ flex: 1, resize: "none", maxHeight: 120, minHeight: 42, boxSizing: "border-box", padding: "11px 13px", borderRadius: 12,
                fontFamily: FONT, fontSize: 14, background: UI.bgElevated, border: `1px solid ${UI.borderStrong}`, color: UI.textPrimary, outline: "none" }} />
            <button onClick={() => void send(input)} disabled={busy || !input.trim()} aria-label="Send"
              style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 12, border: "none", cursor: busy || !input.trim() ? "default" : "pointer",
                background: busy || !input.trim() ? UI.bgPanel : UI.indigo, color: busy || !input.trim() ? UI.textMuted : "#0a0e1a", display: "grid", placeItems: "center" }}>
              <Icon name="send" size={18} />
            </button>
          </div>
        </div>
      </div>

      {confirmReq && <ConfirmModal req={confirmReq} onClose={() => setConfirmReq(null)} />}
    </div>
  );
}

function ConfirmModal({ req, onClose }: { req: ConfirmReq; onClose: () => void }): React.ReactElement {
  const decide = (ok: boolean) => { req.resolve(ok); onClose(); };
  return (
    <div onClick={() => decide(false)} style={{ position: "fixed", inset: 0, zIndex: 130, background: "rgba(2,6,23,0.72)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, background: UI.bgElevated, border: `1px solid ${UI.amber}55`, borderRadius: 16, padding: 20, fontFamily: FONT }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
          <Icon name="alert" size={17} />
          <span style={{ fontSize: 15, fontWeight: 700, color: UI.textPrimary }}>Confirm action</span>
        </div>
        <div style={{ fontSize: 12.5, color: UI.textSecondary, lineHeight: 1.5, marginBottom: 14 }}>
          The agent wants to run a change that writes to your repository:
        </div>
        <code style={{ display: "block", fontFamily: MONO, fontSize: 11.5, color: UI.amber, background: "rgba(251,191,36,0.08)", border: `1px solid ${UI.amber}33`, borderRadius: 9, padding: "10px 12px", marginBottom: 16, wordBreak: "break-word" }}>{req.summary}</code>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={() => decide(false)} style={{ padding: "9px 16px", borderRadius: 10, border: `1px solid ${UI.border}`, background: UI.bgPanel, color: UI.textSecondary, cursor: "pointer", fontFamily: FONT, fontSize: 13, fontWeight: 600 }}>Deny</button>
          <button onClick={() => decide(true)} style={{ padding: "9px 16px", borderRadius: 10, border: "none", background: UI.amber, color: "#0a0e1a", cursor: "pointer", fontFamily: FONT, fontSize: 13, fontWeight: 700 }}>Approve</button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ turn, typing }: { turn: ChatTurn; typing?: boolean }): React.ReactElement {
  const isUser = turn.role === "user";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
      {turn.steps && turn.steps.length > 0 && <AgentSteps steps={turn.steps} />}
      <div style={{
        maxWidth: "88%", padding: "10px 13px", borderRadius: 14,
        borderTopRightRadius: isUser ? 4 : 14, borderTopLeftRadius: isUser ? 14 : 4,
        background: isUser ? UI.indigo : UI.bgPanel,
        color: isUser ? "#0a0e1a" : turn.soft ? UI.textMuted : UI.textPrimary,
        border: isUser ? "none" : `1px solid ${UI.border}`,
        fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}>
        {typing ? <TypingDots label={turn.content !== "…" ? turn.content : undefined} /> : <MdLite text={turn.content} />}
        {turn.via && <div style={{ fontSize: 10.5, color: UI.textMuted, marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}><Icon name="bolt" size={10} /> {turn.via}</div>}
      </div>
    </div>
  );
}

function AgentSteps({ steps }: { steps: AgentStep[] }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ maxWidth: "88%", marginBottom: 6 }}>
      <button onClick={() => setOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 6, background: UI.bgElevated, border: `1px solid ${UI.border}`, borderRadius: 999, padding: "4px 10px", cursor: "pointer", color: UI.textMuted, fontFamily: FONT, fontSize: 11 }}>
        <Icon name="automations" size={11} /> {steps.length} tool step{steps.length === 1 ? "" : "s"} <Icon name="chevron" size={10} />
      </button>
      {open && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          {steps.map((s, i) => (
            <div key={i} style={{ fontFamily: MONO, fontSize: 11, color: s.ok ? UI.textSecondary : UI.red, background: UI.bgElevated, border: `1px solid ${UI.border}`, borderRadius: 8, padding: "6px 9px" }}>
              <div>{s.ok ? "✓" : "✕"} {s.tool} {JSON.stringify(s.args)}</div>
              <div style={{ color: UI.textMuted, marginTop: 3, whiteSpace: "pre-wrap", maxHeight: 88, overflow: "hidden" }}>{s.observation.slice(0, 240)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TypingDots({ label }: { label?: string }): React.ReactElement {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span style={{ display: "inline-flex", gap: 4 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: UI.textMuted, animation: `qdot 1s ${i * 0.15}s infinite ease-in-out` }} />
        ))}
      </span>
      {label && <span style={{ fontSize: 12, color: UI.textMuted }}>{label}</span>}
      <style>{`@keyframes qdot{0%,80%,100%{opacity:.3}40%{opacity:1}}`}</style>
    </span>
  );
}

/** Lightweight markdown: code fences, inline `code`, **bold**. */
function MdLite({ text }: { text: string }): React.ReactElement {
  const parts = useMemo(() => text.split(/```/), [text]);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          return (
            <pre key={i} style={{ margin: "6px 0", padding: "10px 12px", borderRadius: 10, background: "#0a0e17",
              border: `1px solid ${UI.border}`, overflowX: "auto", fontFamily: MONO, fontSize: 12, color: UI.textSecondary, whiteSpace: "pre" }}>
              {part.replace(/^\n/, "").replace(/\n$/, "")}
            </pre>
          );
        }
        return <span key={i}>{part.split("\n").map((line, j) => <React.Fragment key={j}>{j > 0 && <br />}<Inline text={line} /></React.Fragment>)}</span>;
      })}
    </>
  );
}

function Inline({ text }: { text: string }): React.ReactElement {
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {tokens.map((tok, i) => {
        if (tok.startsWith("`") && tok.endsWith("`")) {
          return <code key={i} style={{ fontFamily: MONO, fontSize: "0.86em", background: "rgba(148,163,184,0.16)", padding: "1px 5px", borderRadius: 5 }}>{tok.slice(1, -1)}</code>;
        }
        if (tok.startsWith("**") && tok.endsWith("**")) {
          return <strong key={i} style={{ fontWeight: 700 }}>{tok.slice(2, -2)}</strong>;
        }
        return <React.Fragment key={i}>{tok}</React.Fragment>;
      })}
    </>
  );
}
