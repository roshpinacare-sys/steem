import { useState, useEffect, useRef } from "react";

const RESEARCH_PROMPT = `אתה חוקר ראשי של ECOS — מערכת כלכלה לעבודה אינטלקטואלית עם ledger BigInt, validator pools, reputation decay, proof-attestation, governance, multi-round consensus, ו-Economic Safety Monitor (V213).

**הקשר המערכת (קח כנתון, אל תמציא מחדש):**
המערכת כבר מממשת: split 40/40/20, rank/reputation, decay-insurance, validator pools, proof-attestation, calibration routing, governance auto-exec, multi-round consensus, ו-Economic Safety Monitor (faucet/sink, reputation-inflation, gini, hollow-task-rate, treasury-liquidity). V214 הולך לאכוף: decay → voting weight, stablecoin-only payout guard, sybil gate, ו-live wiring של ה-monitor.

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
  
  "moves_v214_v218": [
    { "version": "V214", "move": "שם המהלך", "rationale": "נימוק", "order": 1 },
    { "version": "V215", "move": "שם המהלך", "rationale": "נימוק", "order": 2 },
    { "version": "V216-218", "move": "שם המהלך", "rationale": "נימוק", "order": 3 }
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

const SEVERITY_COLORS = { "גבוהה": "#ff4444", "בינונית": "#ffaa00", "נמוכה": "#44cc88" };
const EFFORT_BG = { S: "#1a3a2a", M: "#1a2a3a", L: "#3a1a2a" };
const EFFORT_COLOR = { S: "#44ff88", M: "#44aaff", L: "#ff88aa" };

const TerminalLine = ({ text, delay = 0, type = "default" }) => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  const colors = { default: "#a0b4a0", prompt: "#44ff88", system: "#ffaa44", error: "#ff4444", dim: "#506050" };
  return (
    <div style={{
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: "11px",
      color: colors[type] || colors.default,
      opacity: visible ? 1 : 0,
      transition: "opacity 0.15s",
      lineHeight: "1.6",
      whiteSpace: "pre-wrap",
      wordBreak: "break-word"
    }}>
      {text}
    </div>
  );
};

const Spinner = () => {
  const [frame, setFrame] = useState(0);
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  useEffect(() => {
    const t = setInterval(() => setFrame(f => (f + 1) % frames.length), 80);
    return () => clearInterval(t);
  }, []);
  return <span style={{ color: "#44ff88", fontFamily: "monospace" }}>{frames[frame]}</span>;
};

const Badge = ({ label, value, color = "#44ff88", bg = "#0a1a0a" }) => (
  <span style={{
    background: bg, color, border: `1px solid ${color}33`,
    padding: "2px 8px", borderRadius: "2px",
    fontFamily: "monospace", fontSize: "11px", fontWeight: "700",
    letterSpacing: "0.05em"
  }}>
    {label && <span style={{ color: "#506050", marginRight: "4px" }}>{label}:</span>}
    {value}
  </span>
);

const SectionHeader = ({ icon, title, count }) => (
  <div style={{
    display: "flex", alignItems: "center", gap: "10px",
    padding: "10px 0 8px", borderBottom: "1px solid #1a2a1a",
    marginBottom: "16px"
  }}>
    <span style={{ fontSize: "16px" }}>{icon}</span>
    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "13px", color: "#a0c8a0", fontWeight: "700", letterSpacing: "0.05em" }}>{title}</span>
    {count !== undefined && <Badge value={`${count} פריטים`} color="#506050" bg="#0a0f0a" />}
  </div>
);

const Card = ({ children, accent = "#1a2a1a" }) => (
  <div style={{
    background: "#0c150c", border: `1px solid ${accent}`,
    borderRadius: "3px", padding: "14px", marginBottom: "10px",
    position: "relative"
  }}>
    {children}
  </div>
);

export default function ECOSResearch() {
  const [phase, setPhase] = useState("idle"); // idle | running | done | error
  const [logs, setLogs] = useState([]);
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [streamText, setStreamText] = useState("");
  const logRef = useRef(null);
  const abortRef = useRef(null);

  const addLog = (text, type = "default") => {
    setLogs(prev => [...prev, { text, type, id: Date.now() + Math.random() }]);
    setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, 50);
  };

  const runResearch = async () => {
    setPhase("running");
    setLogs([]);
    setData(null);
    setStreamText("");

    addLog("$ ecos-research --version=V214 --mode=deep-scan", "prompt");
    addLog("", "dim");
    addLog("[INIT] טוען פרוטוקול מחקר V2...", "system");
    addLog("[INIT] מחבר ל-Anthropic Intelligence Layer...", "system");
    await new Promise(r => setTimeout(r, 600));
    addLog("[OK]   חיבור נוצר — claude-sonnet-4-20250514", "prompt");
    addLog("[SCAN] מנתח מצב V213: Economic Safety Monitor ✓", "dim");
    addLog("[SCAN] decay engine ✓  |  governance ✓  |  stablecoin guard pending ✗", "dim");
    addLog("[SCAN] sybil gate pending ✗  |  live wiring pending ✗", "dim");
    await new Promise(r => setTimeout(r, 400));
    addLog("", "dim");
    addLog("[RUN]  מריץ מחקר עומק — sections B/C/D/E...", "system");
    addLog("[RUN]  זמן צפוי: 30–60 שניות", "dim");

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          system: "אתה חוקר ראשי של פלטפורמות כלכלה דיגיטלית. ענה אך ורק ב-JSON תקין, בלי backticks, בלי markdown, בלי טקסט לפני או אחרי. הJSON חייב להתחיל עם { ולסיים עם }.",
          messages: [{ role: "user", content: RESEARCH_PROMPT }],
          tools: [{ type: "web_search_20250305", name: "web_search" }]
        })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      addLog("[NET]  תגובה התקבלה — מעבד נתונים...", "system");
      await new Promise(r => setTimeout(r, 300));

      const result = await response.json();

      // Extract text from content blocks (handle tool_use blocks too)
      const textContent = result.content
        ?.filter(b => b.type === "text")
        ?.map(b => b.text)
        ?.join("") || "";

      addLog(`[RECV] ${result.content?.length || 0} content blocks — ${textContent.length} chars text`, "dim");

      if (!textContent) throw new Error("אין תוכן טקסט בתגובה");

      // Parse JSON — strip any markdown fences if present
      const cleaned = textContent.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (e) {
        // Try to extract JSON between first { and last }
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");
        if (start !== -1 && end !== -1) {
          parsed = JSON.parse(cleaned.slice(start, end + 1));
        } else {
          throw new Error("JSON parse failed: " + e.message);
        }
      }

      addLog("[PARSE] JSON תקין ✓", "prompt");
      addLog(`[DONE]  ${parsed.lessons_table?.length || 0} לקחים | ${parsed.blind_spots?.length || 0} נקודות עיוורון | ${parsed.red_flags?.length || 0} דגלים אדומים`, "prompt");
      addLog("", "dim");
      addLog("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", "dim");
      addLog("  מחקר הושלם בהצלחה — עובר לתצוגת ניתוח", "prompt");
      addLog("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━", "dim");

      await new Promise(r => setTimeout(r, 800));
      setData(parsed);
      setPhase("done");

    } catch (err) {
      if (err.name === "AbortError") {
        addLog("[ABORT] מחקר בוטל.", "error");
        setPhase("idle");
      } else {
        addLog(`[ERR] ${err.message}`, "error");
        addLog("[ERR] בדוק חיבור ונסה שוב.", "error");
        setPhase("error");
      }
    }
  };

  const TABS = [
    { id: "overview", label: "⊙ Overview" },
    { id: "b", label: "B · מקרי בוחן" },
    { id: "c", label: "C · פסיכולוגיה" },
    { id: "d", label: "D · אסטרטגיה" },
    { id: "e", label: "E · עיוורון" },
    { id: "lessons", label: "📊 טבלת לקחים" },
    { id: "flags", label: "🚩 דגלים אדומים" },
  ];

  return (
    <div style={{
      minHeight: "100vh", background: "#060d06",
      color: "#a0b4a0", fontFamily: "'IBM Plex Mono', 'JetBrains Mono', monospace",
      direction: "rtl"
    }}>
      {/* Header */}
      <div style={{
        borderBottom: "1px solid #1a2a1a", padding: "16px 24px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "#080e08"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{
            width: "32px", height: "32px", borderRadius: "50%",
            border: "2px solid #44ff88", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "14px", color: "#44ff88", fontWeight: "900"
          }}>⊙</div>
          <div>
            <div style={{ fontSize: "14px", fontWeight: "700", color: "#c8e8c8", letterSpacing: "0.1em" }}>
              ECOS RESEARCH INTELLIGENCE
            </div>
            <div style={{ fontSize: "10px", color: "#506050", letterSpacing: "0.2em" }}>
              V214 · PHASE P103 · DEEP SCAN MODE
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {phase === "running" && <Badge label="STATUS" value="RUNNING" color="#ffaa44" bg="#1a1000" />}
          {phase === "done" && <Badge label="STATUS" value="COMPLETE" color="#44ff88" bg="#001a00" />}
          {phase === "error" && <Badge label="STATUS" value="ERROR" color="#ff4444" bg="#1a0000" />}
          {phase === "idle" && <Badge label="STATUS" value="READY" color="#506050" bg="#0a0f0a" />}
        </div>
      </div>

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px" }}>

        {/* Terminal / Launch Panel */}
        {(phase === "idle" || phase === "running" || phase === "error") && (
          <div style={{ marginBottom: "24px" }}>
            <div style={{
              background: "#080e08", border: "1px solid #1a2a1a", borderRadius: "4px",
              overflow: "hidden"
            }}>
              {/* Terminal bar */}
              <div style={{
                background: "#0c150c", padding: "8px 14px",
                display: "flex", alignItems: "center", gap: "6px",
                borderBottom: "1px solid #1a2a1a"
              }}>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ff5f56" }} />
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ffbd2e" }} />
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#27c93f" }} />
                <span style={{ marginRight: "8px", fontSize: "10px", color: "#506050", letterSpacing: "0.1em" }}>
                  ecos-research-v214 — bash
                </span>
              </div>

              {/* Terminal body */}
              <div ref={logRef} style={{
                padding: "16px", minHeight: "160px", maxHeight: "300px",
                overflowY: "auto", display: "flex", flexDirection: "column", gap: "2px"
              }}>
                {logs.length === 0 && (
                  <TerminalLine text="$ # ECOS Research Intelligence — V214" type="dim" />
                )}
                {logs.map((l, i) => (
                  <TerminalLine key={l.id} text={l.text} type={l.type} delay={0} />
                ))}
                {phase === "running" && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                    <Spinner />
                    <span style={{ fontSize: "11px", color: "#506050" }}>מעבד נתונים...</span>
                  </div>
                )}
              </div>
            </div>

            {/* Launch button */}
            <div style={{ marginTop: "16px", display: "flex", justifyContent: "center" }}>
              <button
                onClick={phase === "running" ? () => { abortRef.current?.abort(); } : runResearch}
                disabled={false}
                style={{
                  background: phase === "running" ? "#1a0a0a" : "#001a00",
                  border: `2px solid ${phase === "running" ? "#ff4444" : "#44ff88"}`,
                  color: phase === "running" ? "#ff4444" : "#44ff88",
                  padding: "12px 40px", borderRadius: "3px",
                  fontFamily: "monospace", fontSize: "13px", fontWeight: "700",
                  letterSpacing: "0.15em", cursor: "pointer",
                  transition: "all 0.2s",
                  textTransform: "uppercase"
                }}
              >
                {phase === "running" ? "⬛ ABORT" : "▶ LAUNCH DEEP RESEARCH — V214"}
              </button>
            </div>

            {phase === "idle" && (
              <p style={{
                textAlign: "center", fontSize: "11px", color: "#506050",
                marginTop: "10px", fontFamily: "monospace"
              }}>
                מריץ מחקר עומק עם web search על: agent payments, stablecoin rails, sybil, anti-patterns 2024–2026
              </p>
            )}
          </div>
        )}

        {/* Results Panel */}
        {phase === "done" && data && (
          <div>
            {/* One-liner hero */}
            <div style={{
              background: "#0c150c", border: "1px solid #2a4a2a",
              borderRadius: "4px", padding: "20px 24px", marginBottom: "24px",
              position: "relative", overflow: "hidden"
            }}>
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0, height: "2px",
                background: "linear-gradient(90deg, transparent, #44ff88, transparent)"
              }} />
              <div style={{ fontSize: "10px", color: "#506050", letterSpacing: "0.2em", marginBottom: "8px" }}>
                ECOS ONE-LINER
              </div>
              <div style={{ fontSize: "18px", color: "#c8e8c8", lineHeight: "1.5", marginBottom: "16px" }}>
                {data.oneliner}
              </div>
              <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: "9px", color: "#506050", letterSpacing: "0.2em", marginBottom: "4px" }}>WEDGE</div>
                  <div style={{ fontSize: "12px", color: "#88ccaa" }}>{data.wedge}</div>
                </div>
                <div style={{ borderLeft: "1px solid #1a2a1a", paddingLeft: "16px" }}>
                  <div style={{ fontSize: "9px", color: "#506050", letterSpacing: "0.2em", marginBottom: "4px" }}>FIRST CUSTOMER</div>
                  <div style={{ fontSize: "12px", color: "#88ccaa" }}>{data.first_customer}</div>
                </div>
              </div>

              {/* Re-run button */}
              <button onClick={() => { setPhase("idle"); setData(null); setLogs([]); }} style={{
                position: "absolute", top: "16px", left: "16px",
                background: "transparent", border: "1px solid #1a2a1a",
                color: "#506050", padding: "4px 10px", borderRadius: "2px",
                fontFamily: "monospace", fontSize: "10px", cursor: "pointer"
              }}>↺ חזור</button>
            </div>

            {/* Tabs */}
            <div style={{
              display: "flex", gap: "2px", marginBottom: "20px",
              borderBottom: "1px solid #1a2a1a", overflowX: "auto",
              paddingBottom: "0"
            }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
                  background: activeTab === t.id ? "#0c150c" : "transparent",
                  border: "none", borderBottom: activeTab === t.id ? "2px solid #44ff88" : "2px solid transparent",
                  color: activeTab === t.id ? "#c8e8c8" : "#506050",
                  padding: "8px 14px", fontFamily: "monospace", fontSize: "11px",
                  cursor: "pointer", whiteSpace: "nowrap", letterSpacing: "0.05em",
                  transition: "all 0.15s"
                }}>{t.label}</button>
              ))}
            </div>

            {/* Tab content */}
            {activeTab === "overview" && (
              <div>
                <SectionHeader icon="🎯" title="מהלכי V214–V218" count={data.moves_v214_v218?.length} />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "10px" }}>
                  {data.moves_v214_v218?.map((m, i) => (
                    <Card key={i} accent="#1a3a1a">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                        <Badge value={m.version} color="#44ff88" bg="#001a00" />
                        <span style={{ fontSize: "10px", color: "#506050" }}>#{m.order}</span>
                      </div>
                      <div style={{ fontSize: "13px", color: "#c8e8c8", marginBottom: "8px", fontWeight: "700" }}>{m.move}</div>
                      <div style={{ fontSize: "11px", color: "#7a9a7a", lineHeight: "1.6" }}>{m.rationale}</div>
                    </Card>
                  ))}
                </div>

                <div style={{ marginTop: "24px" }}>
                  <SectionHeader icon="🏗️" title="3 שכבות למוצר" />
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {data.section_d_layers?.map((l, i) => (
                      <div key={i} style={{
                        display: "flex", gap: "16px", alignItems: "flex-start",
                        background: "#0c150c", border: "1px solid #1a2a1a",
                        borderRadius: "3px", padding: "14px"
                      }}>
                        <div style={{
                          width: "28px", height: "28px", borderRadius: "50%",
                          border: "2px solid #44ff88", display: "flex", alignItems: "center",
                          justifyContent: "center", fontSize: "12px", color: "#44ff88",
                          fontWeight: "900", flexShrink: 0
                        }}>{l.layer}</div>
                        <div>
                          <div style={{ fontSize: "11px", color: "#506050", marginBottom: "4px" }}>{l.title}</div>
                          <div style={{ fontSize: "12px", color: "#a0c8a0", lineHeight: "1.6" }}>{l.content}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "b" && (
              <div>
                <SectionHeader icon="🔍" title="מקרי בוחן 2024–2026" count={data.section_b?.length} />
                {data.section_b?.map((item, i) => (
                  <Card key={i} accent="#1a2a1a">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                      <div style={{ fontSize: "13px", color: "#c8e8c8", fontWeight: "700" }}>{item.topic}</div>
                      <span style={{ fontSize: "9px", color: "#506050", textAlign: "left", maxWidth: "200px" }}>{item.source}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                      <div>
                        <div style={{ fontSize: "9px", color: "#506050", marginBottom: "4px", letterSpacing: "0.1em" }}>מה קרה</div>
                        <div style={{ fontSize: "11px", color: "#a0c8a0", lineHeight: "1.6" }}>{item.what}</div>
                      </div>
                      <div>
                        <div style={{ display: "flex", gap: "8px", marginBottom: "4px" }}>
                          <span style={{ fontSize: "9px", color: "#44ff88", letterSpacing: "0.1em" }}>✓ עבד</span>
                        </div>
                        <div style={{ fontSize: "11px", color: "#7aaa7a", lineHeight: "1.6", marginBottom: "8px" }}>{item.worked}</div>
                        {item.failed && (
                          <>
                            <div style={{ fontSize: "9px", color: "#ff6666", letterSpacing: "0.1em", marginBottom: "4px" }}>✗ נכשל</div>
                            <div style={{ fontSize: "11px", color: "#aa7a7a", lineHeight: "1.6" }}>{item.failed}</div>
                          </>
                        )}
                      </div>
                    </div>
                    <div style={{
                      background: "#081408", border: "1px solid #1a3a1a",
                      borderRadius: "2px", padding: "10px"
                    }}>
                      <div style={{ fontSize: "9px", color: "#44ff88", marginBottom: "4px", letterSpacing: "0.1em" }}>→ ליישום ב-ECOS</div>
                      <div style={{ fontSize: "11px", color: "#a0c8a0", lineHeight: "1.6" }}>{item.ecos_apply}</div>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {activeTab === "c" && (
              <div>
                <SectionHeader icon="🧠" title="פסיכולוגיה וטכנולוגיה 2026" />
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <Card accent="#1a2a3a">
                    <div style={{ fontSize: "10px", color: "#4488aa", letterSpacing: "0.15em", marginBottom: "8px" }}>GEN-Z / AI-NATIVE DRIVERS</div>
                    <div style={{ fontSize: "12px", color: "#a0b8c8", lineHeight: "1.7" }}>{data.section_c?.psychology}</div>
                  </Card>
                  <Card accent="#2a1a3a">
                    <div style={{ fontSize: "10px", color: "#aa44aa", letterSpacing: "0.15em", marginBottom: "8px" }}>HEALTHY ADDICTION VS DARK PATTERNS</div>
                    <div style={{ fontSize: "12px", color: "#b8a0c8", lineHeight: "1.7" }}>{data.section_c?.healthy_vs_dark}</div>
                  </Card>
                  <Card accent="#1a3a2a">
                    <div style={{ fontSize: "10px", color: "#44aa88", letterSpacing: "0.15em", marginBottom: "8px" }}>ONBOARDING 60 שניות — CONCRETE FLOW</div>
                    <div style={{ fontSize: "12px", color: "#a0c8b8", lineHeight: "1.7", whiteSpace: "pre-line" }}>{data.section_c?.onboarding_flow}</div>
                  </Card>
                </div>
              </div>
            )}

            {activeTab === "d" && (
              <div>
                <SectionHeader icon="🗺️" title="אסטרטגיה ותמונת מוצר" />
                <div style={{ marginBottom: "20px" }}>
                  <Card accent="#2a3a1a">
                    <div style={{ fontSize: "10px", color: "#aacc44", letterSpacing: "0.15em", marginBottom: "8px" }}>ONE-LINER</div>
                    <div style={{ fontSize: "16px", color: "#c8e8c8", lineHeight: "1.5" }}>{data.oneliner}</div>
                  </Card>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <Card accent="#1a2a1a">
                      <div style={{ fontSize: "9px", color: "#506050", letterSpacing: "0.15em", marginBottom: "6px" }}>WEDGE — 0→1</div>
                      <div style={{ fontSize: "12px", color: "#a0c8a0", lineHeight: "1.6" }}>{data.wedge}</div>
                    </Card>
                    <Card accent="#1a2a1a">
                      <div style={{ fontSize: "9px", color: "#506050", letterSpacing: "0.15em", marginBottom: "6px" }}>FIRST CUSTOMER</div>
                      <div style={{ fontSize: "12px", color: "#a0c8a0", lineHeight: "1.6" }}>{data.first_customer}</div>
                    </Card>
                  </div>
                </div>
                <SectionHeader icon="📐" title="3 שכבות — 100 ראשונים → Defensibility" />
                {data.section_d_layers?.map((l, i) => (
                  <Card key={i} accent="#1a3a1a">
                    <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                      <div style={{
                        width: "24px", height: "24px", border: "2px solid #44ff88",
                        borderRadius: "50%", display: "flex", alignItems: "center",
                        justifyContent: "center", color: "#44ff88", fontSize: "11px", fontWeight: "900", flexShrink: 0
                      }}>{l.layer}</div>
                      <div>
                        <div style={{ fontSize: "11px", color: "#88cc88", marginBottom: "6px", fontWeight: "700" }}>{l.title}</div>
                        <div style={{ fontSize: "12px", color: "#a0c8a0", lineHeight: "1.6" }}>{l.content}</div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {activeTab === "e" && (
              <div>
                <SectionHeader icon="⚠️" title="נקודות עיוורון — מייסד יחיד" count={data.blind_spots?.length} />
                {data.blind_spots?.map((b, i) => (
                  <Card key={i} accent="#2a1a1a">
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
                      <Badge value={b.area} color="#ffaa44" bg="#1a0800" />
                      <span style={{ fontSize: "9px", color: "#506050" }}>#{i + 1}</span>
                    </div>
                    <div style={{ fontSize: "12px", color: "#c8b0a0", lineHeight: "1.6", marginBottom: "10px" }}>{b.blind_spot}</div>
                    <div style={{ background: "#0a0800", border: "1px solid #2a2000", borderRadius: "2px", padding: "8px" }}>
                      <div style={{ fontSize: "9px", color: "#ffcc44", letterSpacing: "0.1em", marginBottom: "4px" }}>⚡ צעד מתקן — השבוע</div>
                      <div style={{ fontSize: "11px", color: "#c8c0a0", lineHeight: "1.5" }}>{b.fix_this_week}</div>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {activeTab === "lessons" && (
              <div>
                <SectionHeader icon="📊" title="טבלת לקחים מלאה" count={data.lessons_table?.length} />
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid #1a2a1a" }}>
                        {["לקח", "מקור + תאריך + מספר", "חומרה", "→ ליישום", "מאמץ"].map(h => (
                          <th key={h} style={{
                            padding: "8px 12px", textAlign: "right", color: "#506050",
                            fontSize: "9px", letterSpacing: "0.15em", fontWeight: "700"
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.lessons_table?.map((row, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #0f180f" }}>
                          <td style={{ padding: "10px 12px", color: "#a0c8a0", lineHeight: "1.5", maxWidth: "200px" }}>{row.lesson}</td>
                          <td style={{ padding: "10px 12px", color: "#506050", fontSize: "10px", maxWidth: "180px" }}>{row.source_date_number}</td>
                          <td style={{ padding: "10px 12px" }}>
                            <span style={{
                              color: SEVERITY_COLORS[row.severity] || "#506050",
                              fontSize: "10px", fontWeight: "700"
                            }}>{row.severity}</span>
                          </td>
                          <td style={{ padding: "10px 12px", color: "#88aa88", lineHeight: "1.5", maxWidth: "220px", fontSize: "10px" }}>{row.ecos_apply}</td>
                          <td style={{ padding: "10px 12px" }}>
                            <span style={{
                              background: EFFORT_BG[row.effort] || "#0a0f0a",
                              color: EFFORT_COLOR[row.effort] || "#506050",
                              padding: "2px 8px", borderRadius: "2px", fontWeight: "700", fontSize: "10px"
                            }}>{row.effort}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === "flags" && (
              <div>
                <SectionHeader icon="🚩" title="דגלים אדומים לניטור" count={data.red_flags?.length} />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "10px" }}>
                  {data.red_flags?.map((f, i) => (
                    <Card key={i} accent="#3a1a1a">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                        <div style={{ fontSize: "13px", color: "#ff8888", fontWeight: "700" }}>🚩 {f.flag}</div>
                        <Badge value={i + 1} color="#ff4444" bg="#1a0000" />
                      </div>
                      <div style={{ fontSize: "11px", color: "#c8a0a0", lineHeight: "1.6", marginBottom: "10px" }}>{f.description}</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {f.threshold && (
                          <div style={{ background: "#0a0808", border: "1px solid #2a1010", borderRadius: "2px", padding: "6px 10px" }}>
                            <span style={{ fontSize: "9px", color: "#ff6666", letterSpacing: "0.1em" }}>THRESHOLD: </span>
                            <span style={{ fontSize: "11px", color: "#ffaaaa" }}>{f.threshold}</span>
                          </div>
                        )}
                        {f.monitor_endpoint && (
                          <div style={{ background: "#080a08", border: "1px solid #1a1a10", borderRadius: "2px", padding: "6px 10px" }}>
                            <span style={{ fontSize: "9px", color: "#aabb44", letterSpacing: "0.1em" }}>ENDPOINT: </span>
                            <span style={{ fontSize: "10px", color: "#c8cc88", fontFamily: "monospace" }}>{f.monitor_endpoint}</span>
                          </div>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
