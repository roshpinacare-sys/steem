import { useState, useEffect, useRef } from "react";

// ─── Prompt ────────────────────────────────────────────────────────────────
const RESEARCH_PROMPT = `אתה חוקר ראשי של ECOS — מערכת כלכלה לעבודה אינטלקטואלית עם ledger BigInt, validator pools, reputation decay, proof-attestation, governance, multi-round consensus, ו-Economic Safety Monitor (V213).

**הקשר המערכת (קח כנתון, אל תמציא מחדש):**
המערכת כבר מממשת: split 40/40/20, rank/reputation, decay-insurance, validator pools, proof-attestation, calibration routing, governance auto-exec, multi-round consensus, ו-Economic Safety Monitor (faucet/sink, reputation-inflation, gini, hollow-task-rate, treasury-liquidity). V214 כבר אכף: decay → voting weight, stablecoin-only payout guard, sybil gate, ו-live wiring של ה-monitor.

**כללי ברזל לתשובה:**
- כל טענה עובדתית = מקור + תאריך + מספר. אין מקור → כתוב "לא מאומת".
- העדף 2024–2026.
- כל סעיף נגמר ב-"→ ליישום ב-ECOS": 2–4 צעדים קונקרטיים (endpoint/מנגנון/נוסחה/מדד).

**ענה בדיוק בפורמט JSON הבא (אין טקסט לפני/אחרי, רק JSON):**

{
  "oneliner": "משפט אחד שמגדיר את ECOS",
  "wedge": "ה-wedge היחיד ל-0→1",
  "first_customer": "מי הלקוח הראשון ומה ה-Aha moment",
  "section_b": [
    {
      "topic": "שם הנושא (למשל: Agent Payments x402/Skyfire)",
      "what": "מה קרה, מספרים",
      "worked": "מה עבד",
      "failed": "מה נכשל",
      "ecos_apply": "→ ליישום ב-ECOS: צעדים קונקרטיים",
      "source": "מקור + תאריך"
    }
  ],
  "section_c": {
    "psychology": "מה מניע Gen-Z/AI-native ב-2025–2026",
    "healthy_vs_dark": "הבדל בין ממכר בריא ל-dark patterns — דוגמאות 2025",
    "onboarding_flow": "תאר flow קונקרטי של onboarding 60 שניות בצ'אט"
  },
  "section_d_layers": [
    { "layer": 1, "title": "100 הראשונים", "content": "מה משחררים" },
    { "layer": 2, "title": "הופכים לקהילה", "content": "המנגנון" },
    { "layer": 3, "title": "Defensibility", "content": "מה יוצר חפיר" }
  ],
  "moves_v215_v218": [
    { "version": "V215", "move": "שם המהלך", "rationale": "נימוק", "endpoint_hint": "endpoint/מנגנון", "order": 1 },
    { "version": "V216", "move": "שם המהלך", "rationale": "נימוק", "endpoint_hint": "endpoint/מנגנון", "order": 2 },
    { "version": "V217-218", "move": "שם המהלך", "rationale": "נימוק", "endpoint_hint": "endpoint/מנגנון", "order": 3 }
  ],
  "blind_spots": [
    {
      "area": "טכני/רגולטורי/כלכלי/קהילתי/תפעולי",
      "blind_spot": "תיאור נקודת העיוורון",
      "fix_this_week": "צעד מתקן זול לשבוע הקרוב"
    }
  ],
  "lessons_table": [
    {
      "lesson": "הלקח",
      "source_date_number": "מקור + תאריך + מספר",
      "severity": "גבוהה/בינונית/נמוכה",
      "ecos_apply": "endpoint/נוסחה/מדד",
      "effort": "S/M/L"
    }
  ],
  "red_flags": [
    {
      "flag": "שם הדגל האדום",
      "description": "תיאור",
      "threshold": "ערך-סף",
      "monitor_endpoint": "endpoint מומלץ"
    }
  ]
}`;

// ─── V214 implementation status (from CHANGELOG_V214) ──────────────────────
const V214_IMPL = [
  { id: "T01", done: true,  label: "Live Safety Snapshot",       endpoint: "GET /admin/health/economy",           lib: "economicSafetyLiveWire214.js" },
  { id: "T02", done: true,  label: "Safety History",             endpoint: "GET /admin/health/economy/history",   lib: "economicSafetyLiveWire214.js" },
  { id: "T03", done: true,  label: "Payout Guard (single)",      endpoint: "POST /api/v1/payout/check",           lib: "stablecoinPayoutGuard214.js" },
  { id: "T04", done: true,  label: "Payout Guard (batch ≤50)",   endpoint: "POST /api/v1/payout/check-batch",     lib: "stablecoinPayoutGuard214.js" },
  { id: "T05", done: true,  label: "Payout Stats",               endpoint: "GET /api/v1/payout/stats",            lib: "stablecoinPayoutGuard214.js" },
  { id: "T06", done: true,  label: "Sybil: Register Link",       endpoint: "POST /api/v1/sybil/register-link",    lib: "sybilGate214.js" },
  { id: "T07", done: true,  label: "Sybil: Check Gate",          endpoint: "POST /api/v1/sybil/check",            lib: "sybilGate214.js" },
  { id: "T08", done: true,  label: "Sybil: Remove Link",         endpoint: "DELETE /api/v1/sybil/link",           lib: "sybilGate214.js" },
  { id: "T09", done: true,  label: "Sybil: List Links",          endpoint: "GET /api/v1/sybil/links/:userId",     lib: "sybilGate214.js" },
  { id: "T10", done: true,  label: "Sybil: Stats",               endpoint: "GET /api/v1/sybil/stats",             lib: "sybilGate214.js" },
  { id: "T11", done: true,  label: "Decay: Register User",       endpoint: "POST /api/v1/decay/register-user",    lib: "decayEnforcer214.js" },
  { id: "T12", done: true,  label: "Decay: Register Royalty",    endpoint: "POST /api/v1/decay/register-royalty", lib: "decayEnforcer214.js" },
  { id: "T13", done: true,  label: "Decay: Voting Weight",       endpoint: "GET /api/v1/decay/voting-weight/:id", lib: "decayEnforcer214.js" },
  { id: "T14", done: true,  label: "Decay: Royalty Share",       endpoint: "GET /api/v1/decay/royalty-share/:id", lib: "decayEnforcer214.js" },
  { id: "T15", done: true,  label: "Decay: Manual Checkpoint",   endpoint: "POST /api/v1/decay/checkpoint",       lib: "decayEnforcer214.js" },
  { id: "T16", done: true,  label: "Decay: Stats",               endpoint: "GET /api/v1/decay/stats",             lib: "decayEnforcer214.js" },
  { id: "T17", done: true,  label: "Admin Summary V214",         endpoint: "GET /admin/summary/v214",             lib: "all" },
  // V215 roadmap
  { id: "R01", done: false, label: "Sybil gate → task routing",  endpoint: "wire sybilGate214 into calibrationRouting", lib: "V215" },
  { id: "R02", done: false, label: "Payout guard → fiatLedger",  endpoint: "intercept ledger withdrawals",              lib: "V215" },
  { id: "R03", done: false, label: "x402 Agent payment rails",   endpoint: "POST /api/v1/agent/pay (HTTP 402 flow)",    lib: "V215" },
  { id: "R04", done: false, label: "Live reputation feed",       endpoint: "inject userRankSystem into liveWire214",    lib: "V215" },
];

// ─── Palette ────────────────────────────────────────────────────────────────
const C = {
  bg: "#060d06", surface: "#080e08", card: "#0c150c",
  border: "#1a2a1a", accent: "#44ff88", dim: "#506050",
  warn: "#ffaa44", err: "#ff4444", info: "#44aaff",
  text: "#a0c8a0", textBright: "#c8e8c8", textDim: "#6a8a6a",
};
const SEV = { "גבוהה": "#ff4444", "בינונית": "#ffaa00", "נמוכה": "#44cc88" };
const EFFORT_STYLE = {
  S: { bg: "#0d2018", color: "#44ff88" },
  M: { bg: "#0d1a28", color: "#44aaff" },
  L: { bg: "#280d1a", color: "#ff88aa" },
};

// ─── Small components ───────────────────────────────────────────────────────
const Badge = ({ label, value, color = C.accent, bg = C.card }) => (
  <span style={{ background: bg, color, border: `1px solid ${color}33`, padding: "2px 8px", borderRadius: "2px", fontFamily: "monospace", fontSize: "10px", fontWeight: 700 }}>
    {label && <span style={{ color: C.dim, marginRight: 4 }}>{label}:</span>}
    {value}
  </span>
);

const SectionHeader = ({ icon, title, count }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0 8px", borderBottom: `1px solid ${C.border}`, marginBottom: 16 }}>
    <span style={{ fontSize: 16 }}>{icon}</span>
    <span style={{ fontFamily: "monospace", fontSize: 13, color: "#a0c8a0", fontWeight: 700, letterSpacing: "0.05em" }}>{title}</span>
    {count !== undefined && <Badge value={`${count}`} color={C.dim} bg={C.surface} />}
  </div>
);

const Card = ({ children, accent = C.border, style = {} }) => (
  <div style={{ background: C.card, border: `1px solid ${accent}`, borderRadius: 3, padding: 14, marginBottom: 10, ...style }}>
    {children}
  </div>
);

const Spinner = () => {
  const [f, setF] = useState(0);
  const frames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
  useEffect(() => { const t = setInterval(() => setF(x => (x+1)%frames.length), 80); return () => clearInterval(t); }, []);
  return <span style={{ color: C.accent, fontFamily: "monospace" }}>{frames[f]}</span>;
};

const TerminalLine = ({ text, type = "default", delay = 0 }) => {
  const [vis, setVis] = useState(delay === 0);
  useEffect(() => { if (delay > 0) { const t = setTimeout(() => setVis(true), delay); return () => clearTimeout(t); } }, [delay]);
  const col = { default: "#a0b4a0", prompt: C.accent, system: C.warn, error: C.err, dim: C.dim }[type] || C.text;
  return (
    <div style={{ fontFamily: "monospace", fontSize: 11, color: col, opacity: vis ? 1 : 0, transition: "opacity 0.15s", lineHeight: "1.6", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {text}
    </div>
  );
};

// ─── Implementation status panel ────────────────────────────────────────────
const ImplPanel = () => {
  const done = V214_IMPL.filter(x => x.done);
  const todo = V214_IMPL.filter(x => !x.done);
  const pct = Math.round((done.length / V214_IMPL.length) * 100);

  return (
    <div>
      <SectionHeader icon="⚙️" title={`V214 Implementation Status — ${done.length}/${V214_IMPL.length} endpoints`} />
      {/* Progress bar */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 11, color: C.textDim }}>P103 progress</span>
          <Badge value={`${pct}%`} color={C.accent} />
        </div>
        <div style={{ height: 6, background: "#0a120a", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg, #44ff88, #22cc66)", borderRadius: 3, transition: "width 0.5s" }} />
        </div>
      </div>

      {/* Done */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: C.dim, letterSpacing: "0.15em", marginBottom: 8 }}>SHIPPED ✓</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 6 }}>
          {done.map(item => (
            <div key={item.id} style={{ background: "#081408", border: "1px solid #1a3a1a", borderRadius: 2, padding: "8px 10px", display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ color: C.accent, fontSize: 10, flexShrink: 0, marginTop: 1 }}>✓</span>
              <div>
                <div style={{ fontSize: 11, color: C.textBright, marginBottom: 2 }}>{item.label}</div>
                <div style={{ fontSize: 9, color: C.dim, fontFamily: "monospace" }}>{item.endpoint}</div>
              </div>
              <Badge value={item.id} color="#2a4a2a" bg="#040804" />
            </div>
          ))}
        </div>
      </div>

      {/* Roadmap */}
      <div>
        <div style={{ fontSize: 10, color: C.dim, letterSpacing: "0.15em", marginBottom: 8 }}>V215 ROADMAP →</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 6 }}>
          {todo.map(item => (
            <div key={item.id} style={{ background: "#0a0d0a", border: "1px solid #1a2a1a", borderRadius: 2, padding: "8px 10px", display: "flex", gap: 8, alignItems: "flex-start", opacity: 0.7 }}>
              <span style={{ color: C.dim, fontSize: 10, flexShrink: 0, marginTop: 1 }}>○</span>
              <div>
                <div style={{ fontSize: 11, color: C.textDim, marginBottom: 2 }}>{item.label}</div>
                <div style={{ fontSize: 9, color: "#3a5a3a", fontFamily: "monospace" }}>{item.endpoint}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Overview panel ──────────────────────────────────────────────────────────
const OverviewPanel = ({ data }) => (
  <div>
    <SectionHeader icon="⊙" title="Overview — V214 Research & Strategy" />
    <Card accent="#2a3a1a" style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10, color: "#aacc44", letterSpacing: "0.15em", marginBottom: 8 }}>ONE-LINER</div>
      <div style={{ fontSize: 15, color: C.textBright, lineHeight: 1.5 }}>{data.oneliner}</div>
    </Card>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
      <Card>
        <div style={{ fontSize: 9, color: C.dim, letterSpacing: "0.15em", marginBottom: 6 }}>WEDGE — 0→1</div>
        <div style={{ fontSize: 12, color: C.text, lineHeight: 1.6 }}>{data.wedge}</div>
      </Card>
      <Card>
        <div style={{ fontSize: 9, color: C.dim, letterSpacing: "0.15em", marginBottom: 6 }}>FIRST CUSTOMER</div>
        <div style={{ fontSize: 12, color: C.text, lineHeight: 1.6 }}>{data.first_customer}</div>
      </Card>
    </div>

    {/* Moves V215+ */}
    <SectionHeader icon="🚀" title="Moves V215–V218" />
    {data.moves_v215_v218?.map((m, i) => (
      <Card key={i} accent="#1a3a1a">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <Badge value={m.version} color={C.accent} bg="#051405" />
          <span style={{ fontSize: 11, color: C.textBright, fontWeight: 700 }}>{m.move}</span>
          <Badge value={`#${m.order}`} color={C.dim} bg={C.surface} />
        </div>
        <div style={{ fontSize: 11, color: C.text, lineHeight: 1.6, marginBottom: 6 }}>{m.rationale}</div>
        {m.endpoint_hint && (
          <div style={{ fontSize: 10, color: C.dim, fontFamily: "monospace" }}>→ {m.endpoint_hint}</div>
        )}
      </Card>
    ))}
  </div>
);

// ─── Main component ──────────────────────────────────────────────────────────
export default function ECOSResearch() {
  const [phase, setPhase] = useState("idle");
  const [logs, setLogs] = useState([]);
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState("impl");
  const [exportMsg, setExportMsg] = useState("");
  const logRef = useRef(null);
  const abortRef = useRef(null);

  const addLog = (text, type = "default") => {
    setLogs(prev => [...prev, { text, type, id: Date.now() + Math.random() }]);
    setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, 50);
  };

  const runResearch = async () => {
    setPhase("running"); setLogs([]); setData(null); setExportMsg("");
    addLog("$ ecos-research --version=V214 --mode=deep-scan --web=true", "prompt");
    addLog("", "dim");
    addLog("[INIT] טוען פרוטוקול מחקר V2...", "system");
    addLog("[INIT] מחבר ל-Anthropic Intelligence Layer (claude-sonnet-4-20250514)...", "system");
    await new Promise(r => setTimeout(r, 500));
    addLog("[OK]   חיבור נוצר + web_search מופעל", "prompt");
    addLog("[SCAN] V214 implemented: live-wire ✓ | payout-guard ✓ | sybil-gate ✓ | decay-enforcer ✓", "dim");
    addLog("[SCAN] V215 roadmap: agent-payments ○ | task-routing-integration ○ | x402 ○", "dim");
    await new Promise(r => setTimeout(r, 400));
    addLog("", "dim");
    addLog("[RUN]  מריץ מחקר עומק — sections B/C/D/E + V215 moves...", "system");
    addLog("[RUN]  זמן צפוי: 30–60 שניות (web_search פעיל)", "dim");

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 5000,
          system: "אתה חוקר ראשי של פלטפורמות כלכלה דיגיטלית. ענה אך ורק ב-JSON תקין, בלי backticks, בלי markdown, בלי טקסט לפני או אחרי. הJSON חייב להתחיל עם { ולסיים עם }.",
          messages: [{ role: "user", content: RESEARCH_PROMPT }],
          tools: [{ type: "web_search_20250305", name: "web_search" }]
        })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text().then(t => t.slice(0, 200))}`);
      addLog("[NET]  תגובה התקבלה — מעבד נתונים...", "system");
      await new Promise(r => setTimeout(r, 200));

      const result = await response.json();
      const textContent = result.content?.filter(b => b.type === "text")?.map(b => b.text)?.join("") || "";
      const toolUses = result.content?.filter(b => b.type === "tool_use")?.length || 0;

      addLog(`[RECV] ${result.content?.length || 0} blocks | ${toolUses} web searches | ${textContent.length} chars text`, "dim");
      if (!textContent) throw new Error("אין תוכן טקסט בתגובה");

      const cleaned = textContent.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      let parsed;
      try { parsed = JSON.parse(cleaned); }
      catch {
        const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
        if (s !== -1 && e !== -1) parsed = JSON.parse(cleaned.slice(s, e + 1));
        else throw new Error("JSON parse failed");
      }

      addLog("[PARSE] JSON תקין ✓", "prompt");
      addLog(`[DONE]  ${parsed.lessons_table?.length || 0} לקחים | ${parsed.blind_spots?.length || 0} עיוורונות | ${parsed.red_flags?.length || 0} דגלים`, "prompt");
      addLog("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", "dim");

      await new Promise(r => setTimeout(r, 600));
      setData(parsed);
      setPhase("done");
      setActiveTab("overview");
    } catch (err) {
      if (err.name === "AbortError") { addLog("[ABORT] מחקר בוטל.", "error"); setPhase("idle"); }
      else { addLog(`[ERR] ${err.message}`, "error"); setPhase("error"); }
    }
  };

  const exportJSON = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ecos-research-v214-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
    setExportMsg("ייצוא הצליח ✓");
    setTimeout(() => setExportMsg(""), 3000);
  };

  const TABS = [
    { id: "impl",    label: "⚙️ V214 Impl" },
    { id: "overview",label: "⊙ Overview",    needsData: true },
    { id: "b",       label: "B · מקרי בוחן", needsData: true },
    { id: "c",       label: "C · פסיכולוגיה",needsData: true },
    { id: "d",       label: "D · 3 שכבות",   needsData: true },
    { id: "e",       label: "E · עיוורון",    needsData: true },
    { id: "lessons", label: "📊 לקחים",       needsData: true },
    { id: "flags",   label: "🚩 דגלים",       needsData: true },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'IBM Plex Mono', 'JetBrains Mono', monospace", direction: "rtl" }}>
      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", background: C.surface }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", border: `2px solid ${C.accent}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: C.accent, fontWeight: 900 }}>⊙</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.textBright, letterSpacing: "0.1em" }}>ECOS RESEARCH INTELLIGENCE</div>
            <div style={{ fontSize: 10, color: C.dim, letterSpacing: "0.2em" }}>V214 · PHASE P103 · DEEP SCAN + WEB SEARCH</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {phase === "running" && <Badge label="STATUS" value="RUNNING" color={C.warn} bg="#1a1000" />}
          {phase === "done"    && <Badge label="STATUS" value="COMPLETE" color={C.accent} bg="#001a00" />}
          {phase === "error"   && <Badge label="STATUS" value="ERROR" color={C.err} bg="#1a0000" />}
          {phase === "idle"    && <Badge label="STATUS" value="READY" color={C.dim} bg={C.surface} />}
          {data && (
            <button onClick={exportJSON} style={{ background: "#051405", border: `1px solid #1a3a1a`, color: C.accent, fontFamily: "monospace", fontSize: 10, padding: "4px 10px", borderRadius: 2, cursor: "pointer" }}>
              ⬇ JSON
            </button>
          )}
          {exportMsg && <span style={{ fontSize: 10, color: C.accent }}>{exportMsg}</span>}
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
        {/* Terminal */}
        {(phase !== "done" || !data) && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
              <div style={{ background: C.card, padding: "8px 14px", display: "flex", alignItems: "center", gap: 6, borderBottom: `1px solid ${C.border}` }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ff5f56" }} />
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ffbd2e" }} />
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#27c93f" }} />
                <span style={{ marginRight: 8, fontSize: 10, color: C.dim }}>ecos-research-v214 — bash</span>
              </div>
              <div ref={logRef} style={{ padding: 16, minHeight: 140, maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                {logs.length === 0 && <TerminalLine text="$ # ECOS Research Intelligence V214 — ready" type="dim" />}
                {logs.map(l => <TerminalLine key={l.id} text={l.text} type={l.type} />)}
                {phase === "running" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <Spinner /><span style={{ fontSize: 11, color: C.dim }}>מריץ מחקר עומק + web search...</span>
                  </div>
                )}
              </div>
            </div>
            <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
              <button
                onClick={phase === "running" ? () => abortRef.current?.abort() : runResearch}
                style={{
                  background: phase === "running" ? "#1a0a0a" : "#001a00",
                  border: `2px solid ${phase === "running" ? C.err : C.accent}`,
                  color: phase === "running" ? C.err : C.accent,
                  fontFamily: "monospace", fontSize: 13, fontWeight: 700,
                  padding: "10px 28px", borderRadius: 2, cursor: "pointer",
                  letterSpacing: "0.1em"
                }}>
                {phase === "running" ? "■ ABORT" : "▶ RUN RESEARCH V214"}
              </button>
            </div>
          </div>
        )}

        {/* Tabs (always visible) */}
        <div style={{ display: "flex", gap: 2, marginBottom: 20, flexWrap: "wrap", borderBottom: `1px solid ${C.border}`, paddingBottom: 12 }}>
          {TABS.map(t => {
            const disabled = t.needsData && !data;
            const active = activeTab === t.id;
            return (
              <button key={t.id} onClick={() => !disabled && setActiveTab(t.id)} disabled={disabled}
                style={{
                  background: active ? "#0d200d" : "transparent",
                  border: `1px solid ${active ? C.accent : disabled ? "#0f180f" : C.border}`,
                  color: active ? C.accent : disabled ? "#2a3a2a" : C.textDim,
                  fontFamily: "monospace", fontSize: 11, padding: "6px 12px", borderRadius: 2,
                  cursor: disabled ? "not-allowed" : "pointer", letterSpacing: "0.05em"
                }}>
                {t.label}
              </button>
            );
          })}
          {phase === "done" && (
            <button onClick={() => { setPhase("idle"); setData(null); setActiveTab("impl"); setLogs([]); }}
              style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.dim, fontFamily: "monospace", fontSize: 10, padding: "6px 10px", borderRadius: 2, cursor: "pointer", marginRight: "auto" }}>
              ↺ איפוס
            </button>
          )}
        </div>

        {/* Tab content */}
        <div>
          {activeTab === "impl" && <ImplPanel />}
          {activeTab === "overview" && data && <OverviewPanel data={data} />}

          {activeTab === "b" && data && (
            <div>
              <SectionHeader icon="🔍" title="מקרי בוחן 2024–2026" count={data.section_b?.length} />
              {data.section_b?.map((item, i) => (
                <Card key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div style={{ fontSize: 13, color: C.textBright, fontWeight: 700 }}>{item.topic}</div>
                    <span style={{ fontSize: 9, color: C.dim, maxWidth: 200, textAlign: "left" }}>{item.source}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 9, color: C.dim, marginBottom: 4, letterSpacing: "0.1em" }}>מה קרה</div>
                      <div style={{ fontSize: 11, color: C.text, lineHeight: 1.6 }}>{item.what}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: C.accent, letterSpacing: "0.1em", marginBottom: 4 }}>✓ עבד</div>
                      <div style={{ fontSize: 11, color: "#7aaa7a", lineHeight: 1.6, marginBottom: 8 }}>{item.worked}</div>
                      {item.failed && <>
                        <div style={{ fontSize: 9, color: C.err, letterSpacing: "0.1em", marginBottom: 4 }}>✗ נכשל</div>
                        <div style={{ fontSize: 11, color: "#aa7a7a", lineHeight: 1.6 }}>{item.failed}</div>
                      </>}
                    </div>
                  </div>
                  <div style={{ background: "#081408", border: `1px solid #1a3a1a`, borderRadius: 2, padding: 10 }}>
                    <div style={{ fontSize: 9, color: C.accent, marginBottom: 4, letterSpacing: "0.1em" }}>→ ליישום ב-ECOS</div>
                    <div style={{ fontSize: 11, color: C.text, lineHeight: 1.6 }}>{item.ecos_apply}</div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {activeTab === "c" && data && (
            <div>
              <SectionHeader icon="🧠" title="פסיכולוגיה וטכנולוגיה 2026" />
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Card accent="#1a2a3a">
                  <div style={{ fontSize: 10, color: "#4488aa", letterSpacing: "0.15em", marginBottom: 8 }}>GEN-Z / AI-NATIVE DRIVERS</div>
                  <div style={{ fontSize: 12, color: "#a0b8c8", lineHeight: 1.7 }}>{data.section_c?.psychology}</div>
                </Card>
                <Card accent="#2a1a3a">
                  <div style={{ fontSize: 10, color: "#aa44aa", letterSpacing: "0.15em", marginBottom: 8 }}>HEALTHY ADDICTION VS DARK PATTERNS</div>
                  <div style={{ fontSize: 12, color: "#b8a0c8", lineHeight: 1.7 }}>{data.section_c?.healthy_vs_dark}</div>
                </Card>
                <Card accent="#1a3a2a">
                  <div style={{ fontSize: 10, color: "#44aa88", letterSpacing: "0.15em", marginBottom: 8 }}>ONBOARDING 60 שניות — CONCRETE FLOW</div>
                  <div style={{ fontSize: 12, color: "#a0c8b8", lineHeight: 1.7, whiteSpace: "pre-line" }}>{data.section_c?.onboarding_flow}</div>
                </Card>
              </div>
            </div>
          )}

          {activeTab === "d" && data && (
            <div>
              <SectionHeader icon="🗺️" title="3 שכבות — 100 ראשונים → Defensibility" />
              {data.section_d_layers?.map((l, i) => (
                <Card key={i} accent="#1a3a1a">
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <div style={{ width: 24, height: 24, border: `2px solid ${C.accent}`, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: C.accent, fontSize: 11, fontWeight: 900, flexShrink: 0 }}>{l.layer}</div>
                    <div>
                      <div style={{ fontSize: 11, color: "#88cc88", marginBottom: 6, fontWeight: 700 }}>{l.title}</div>
                      <div style={{ fontSize: 12, color: C.text, lineHeight: 1.6 }}>{l.content}</div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {activeTab === "e" && data && (
            <div>
              <SectionHeader icon="⚠️" title="נקודות עיוורון — מייסד יחיד" count={data.blind_spots?.length} />
              {data.blind_spots?.map((b, i) => (
                <Card key={i} accent="#2a1a1a">
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <Badge value={b.area} color={C.warn} bg="#1a0800" />
                    <span style={{ fontSize: 9, color: C.dim }}>#{i+1}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#c8b0a0", lineHeight: 1.6, marginBottom: 10 }}>{b.blind_spot}</div>
                  <div style={{ background: "#0a0800", border: "1px solid #2a2000", borderRadius: 2, padding: "8px 10px" }}>
                    <div style={{ fontSize: 9, color: "#ffcc44", letterSpacing: "0.1em", marginBottom: 4 }}>⚡ צעד מתקן — השבוע</div>
                    <div style={{ fontSize: 11, color: "#c8c0a0", lineHeight: 1.5 }}>{b.fix_this_week}</div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {activeTab === "lessons" && data && (
            <div>
              <SectionHeader icon="📊" title="טבלת לקחים מלאה" count={data.lessons_table?.length} />
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      {["לקח","מקור + תאריך + מספר","חומרה","→ ליישום","מאמץ"].map(h => (
                        <th key={h} style={{ padding: "8px 12px", textAlign: "right", color: C.dim, fontSize: 9, letterSpacing: "0.15em", fontWeight: 700 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.lessons_table?.map((row, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #0f180f" }}>
                        <td style={{ padding: "10px 12px", color: C.text, lineHeight: 1.5, maxWidth: 200 }}>{row.lesson}</td>
                        <td style={{ padding: "10px 12px", color: C.dim, fontSize: 10, maxWidth: 180 }}>{row.source_date_number}</td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ color: SEV[row.severity] || C.dim, fontSize: 10, fontWeight: 700 }}>{row.severity}</span>
                        </td>
                        <td style={{ padding: "10px 12px", color: "#88aa88", lineHeight: 1.5, maxWidth: 220, fontSize: 10 }}>{row.ecos_apply}</td>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ background: EFFORT_STYLE[row.effort]?.bg || C.card, color: EFFORT_STYLE[row.effort]?.color || C.dim, padding: "2px 8px", borderRadius: 2, fontWeight: 700, fontSize: 10 }}>{row.effort}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "flags" && data && (
            <div>
              <SectionHeader icon="🚩" title="דגלים אדומים לניטור" count={data.red_flags?.length} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
                {data.red_flags?.map((f, i) => (
                  <Card key={i} accent="#3a1a1a">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                      <div style={{ fontSize: 13, color: "#ff8888", fontWeight: 700 }}>🚩 {f.flag}</div>
                      <Badge value={i+1} color={C.err} bg="#1a0000" />
                    </div>
                    <div style={{ fontSize: 11, color: "#c8a0a0", lineHeight: 1.6, marginBottom: 10 }}>{f.description}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {f.threshold && (
                        <div style={{ background: "#0a0808", border: "1px solid #2a1010", borderRadius: 2, padding: "6px 10px" }}>
                          <span style={{ fontSize: 9, color: "#ff6666", letterSpacing: "0.1em" }}>THRESHOLD: </span>
                          <span style={{ fontSize: 11, color: "#ffaaaa" }}>{f.threshold}</span>
                        </div>
                      )}
                      {f.monitor_endpoint && (
                        <div style={{ background: "#080a08", border: "1px solid #1a1a10", borderRadius: 2, padding: "6px 10px" }}>
                          <span style={{ fontSize: 9, color: "#aabb44", letterSpacing: "0.1em" }}>ENDPOINT: </span>
                          <span style={{ fontSize: 10, color: "#c8cc88", fontFamily: "monospace" }}>{f.monitor_endpoint}</span>
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
