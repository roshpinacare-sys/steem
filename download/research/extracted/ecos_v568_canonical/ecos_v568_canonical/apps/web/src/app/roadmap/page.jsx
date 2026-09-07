import { useState } from "react";

const phases = [
  {
    id: "p0",
    label: "P0 — Production Hardening",
    timeframe: "שבוע 1–2",
    color: "#ef4444",
    bgColor: "rgba(239,68,68,0.08)",
    borderColor: "rgba(239,68,68,0.3)",
    description: "חובה לפני כל טרנזקציה אמיתית",
    prompt: `אתה עובד על ECOS V100. תקן את הבעיות הבאות ב-ecos-api-server.js ו-lib/config.js:

1. DATABASE_URL חסר → צריך להיות hard error (process.exit(1)) בproduction, לא warning
2. JWT_SECRET default "ecos-dev-secret" → validateConfig() כבר קיים ב-lib/config.js, רק ודא שה-exit code 1 נזרק ב-production אם JWT_SECRET < 32 תווים
3. Rate limiting חסר ב-/chat ו-/task → הוסף rateLimiter middleware (כבר קיים בקוד לendpoints אחרים, שחזר לאלו)
4. Monitor service → הוסף alert כשaudit chain verification נכשל

לאחר כל שינוי:
- הרץ npm test וודא שכל 275+ טסטים עוברים
- הוסף טסט ב-tests/config.test.js לכל בעיה שתיקנת
- bump version ל-V101 ב-package.json ובכל מחרוזות גרסה ב-ecos-api-server.js`,
    tasks: [
      { id: "p0-1", text: "DATABASE_URL חסר → hard error (לא warning)", file: "lib/config.js", status: "todo" },
      { id: "p0-2", text: "JWT_SECRET < 32 תווים → block production", file: "lib/config.js", status: "todo" },
      { id: "p0-3", text: "Rate limiting על /chat ו-/task", file: "ecos-api-server.js", status: "todo" },
      { id: "p0-4", text: "Alert כשaudit chain verification נכשל", file: "monitor/", status: "todo" },
    ],
  },
  {
    id: "p1",
    label: "P1 — API Completeness",
    timeframe: "שבוע 3–4",
    color: "#f59e0b",
    bgColor: "rgba(245,158,11,0.08)",
    borderColor: "rgba(245,158,11,0.3)",
    description: "השלם את ה-API לפי NEXT_SESSION_PROMPT V101",
    prompt: `אתה עובד על ECOS V101 (אחרי P0). הוסף את 3 הsystems הבאים:

SYSTEM 1 — Webhook Delivery Log
- lib/notificationService.js: הוסף ring buffer של delivery attempts (success/failure/latency)
- GET /api/v1/webhooks/:accountId/log — last N delivery records
- GET /api/v1/health/detailed: הוסף checks.notifications.recentFailures
- tests/notification.test.js: +3 טסטים

SYSTEM 2 — Approval Bulk Operations  
- POST /api/v1/approvals/bulk-resolve — עד 50 אישורים בקריאה אחת
- Returns: { resolved, failed, summary }
- apps/web/src/app/validator/page.jsx: כפתור bulk-approve
- tests/batchTask.test.js: +3 טסטים

SYSTEM 3 — Rate Limit Headers
- הוסף X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset לכל endpoint שמוגבל (/task, /chat, /deposit, /batch)
- tests/rateLimiter.test.js: +2 טסטים

אל תגע ב-lib/fiatLedger.js ו-lib/auditLog.js (Sacred Files).
bump version ל-V101 (אם לא נעשה ב-P0) ורץ npm test — ≥285 טסטים.`,
    tasks: [
      { id: "p1-1", text: "Webhook Delivery Log (ring buffer)", file: "lib/notificationService.js", status: "todo" },
      { id: "p1-2", text: "Approval Bulk Operations (50 max)", file: "ecos-api-server.js", status: "todo" },
      { id: "p1-3", text: "Rate Limit Headers על כל endpoints", file: "ecos-api-server.js", status: "todo" },
      { id: "p1-4", text: "OpenAPI V101 update", file: "docs/openapi.json", status: "todo" },
    ],
  },
  {
    id: "p2",
    label: "P2 — Trust Infrastructure",
    timeframe: "חודש 2–3",
    color: "#6366f1",
    bgColor: "rgba(99,102,241,0.08)",
    borderColor: "rgba(99,102,241,0.3)",
    description: "הדברים שהופכים app לinfrastructure",
    prompt: `אתה עובד על ECOS V102. הוסף את 3 הsystems הבאים:

SYSTEM 1 — Persistent Agent Identity
- lib/agentIdentity.js: מחלקה חדשה. agentId (UUID), createdAt, taskCount, successRate, totalEarningsMicrocents, reputationScore (0-100)
- POST /api/v1/agents — רישום agent חדש
- GET /api/v1/agents/:id — פרופיל + history summary
- GET /api/v1/agents/:id/tasks — משימות עם cursor pagination
- ecos-api-server.js: כשtask מגיע עם agentId header, record outcome אחרי resolve
- tests/agent.test.js: עדכן (+5 טסטים לidentity persistence)

SYSTEM 2 — External Audit Chain Verifier
- scripts/verify-chain.mjs: כבר קיים — שדרג לtool ציבורי
  - קבל --export-file <path> (מהGET /api/v1/export/audit-report)
  - פלט: JSON עם chainLength, verified: true/false, firstBlock, lastBlock, anyTampering
  - README: הוסף פרק "Independent Verification" עם דוגמה
- GET /api/v1/export/chain-snapshot — endpoint חדש, מחזיר רק hash chain בלי payload

SYSTEM 3 — Tiered Trust Model
- lib/trustPolicy.js: מחלקה חדשה
  - evaluateAction(agentId, taskType, amountMicrocents) → { tier: 'AUTO'|'HITL'|'BLOCK', reason }
  - Tier AUTO: agent עם >100 tasks, successRate >0.85, amount < AUTO_LIMIT env var
  - Tier HITL: default לכל השאר
  - Tier BLOCK: agent עם successRate <0.5 אחרי >20 tasks
- ecos-api-server.js: wire trustPolicy.evaluateAction() לפני confidenceGate ב-POST /api/v1/task

bump ל-V102, npm test ≥295 טסטים.`,
    tasks: [
      { id: "p2-1", text: "Persistent Agent Identity System", file: "lib/agentIdentity.js (חדש)", status: "todo" },
      { id: "p2-2", text: "External Audit Chain Verifier Tool", file: "scripts/verify-chain.mjs", status: "todo" },
      { id: "p2-3", text: "Tiered Trust Model (AUTO/HITL/BLOCK)", file: "lib/trustPolicy.js (חדש)", status: "todo" },
      { id: "p2-4", text: "Validator Earnings History endpoint", file: "ecos-api-server.js", status: "todo" },
    ],
  },
  {
    id: "p3",
    label: "P3 — Protocol Adoption",
    timeframe: "חודש 4–6",
    color: "#22c55e",
    bgColor: "rgba(34,197,94,0.08)",
    borderColor: "rgba(34,197,94,0.3)",
    description: "כשאחרים בונים על ECOS — ה-thesis מוכח",
    prompt: `אתה עובד על ECOS V103. הוסף את 3 הsystems הבאים:

SYSTEM 1 — Mission Status Dashboard (Per Client)
- GET /api/v1/dashboard?clientId= — aggregated live stats:
  { pending, approved, rejected, totalSpend, autoFlowRate, hitlRate, calibratorAccuracy, dailyTrend: [{date, tasks, spend}] }
- apps/web/src/app/dashboard/page.jsx: לייב dashboard עם recharts sparkline
- tests/integration.test.js: +3 טסטים

SYSTEM 2 — Sacred Files Governance Protocol (Public)
- docs/GOVERNANCE.md: קובץ חדש
  - Sacred Files רשומים עם hash + תאריך נעילה
  - Protocol Change Policy: שינוי → PR → 30 days notice → migration guide
  - אסורים מוחלטים (3 דברים שECOS לעולם לא יעשה)
- scripts/verify-sacred.mjs: script שמוודא MD5 hashes בCLI
  - ecos-cli.js: הוסף פקודה "sacred-check"

SYSTEM 3 — Developer SDK Bootstrap
- sdk/ecos-client.js: client library פשוט
  - new EcosClient({ baseUrl, apiKey })
  - client.submitTask(prompt, taskInput, opts) → Promise<{ missionId, status, confidence }>
  - client.getResult(missionId) → Promise<{ verdict, split }>
  - client.onApproval(missionId, callback) → WebSocket subscription
- docs/SDK.md: תיעוד מלא עם דוגמאות
- tests/sdk.test.js: 5 טסטים

bump ל-V103, npm test ≥310 טסטים.`,
    tasks: [
      { id: "p3-1", text: "Mission Status Dashboard (per client)", file: "apps/web/dashboard/page.jsx", status: "todo" },
      { id: "p3-2", text: "Sacred Files Governance Protocol", file: "docs/GOVERNANCE.md (חדש)", status: "todo" },
      { id: "p3-3", text: "Developer SDK Bootstrap", file: "sdk/ecos-client.js (חדש)", status: "todo" },
      { id: "p3-4", text: "CLI stream reconnect עם exponential backoff", file: "ecos-cli.js", status: "todo" },
    ],
  },
];

const moats = [
  { label: "Data Moat", strength: 15, target: 100, color: "#6366f1", desc: "calibration history, validator track records" },
  { label: "Audit Chain", strength: 60, target: 100, color: "#22c55e", desc: "SHA-256 chain קיים, חסר external verifier" },
  { label: "Validator Network", strength: 20, target: 100, color: "#f59e0b", desc: "רפוטציה קיימת, identity persistence חסר" },
  { label: "Sacred File Trust", strength: 45, target: 100, color: "#ef4444", desc: "CI locks קיים, governance policy חסר" },
];

export default function EcosRoadmap() {
  const [activePhase, setActivePhase] = useState(null);
  const [copied, setCopied] = useState(false);
  const [tasks, setTasks] = useState(() => {
    const initial = {};
    phases.forEach(p => p.tasks.forEach(t => { initial[t.id] = false; }));
    return initial;
  });

  const copyPrompt = (prompt) => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleTask = (taskId) => {
    setTasks(prev => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  const getProgress = (phase) => {
    const phaseTasks = phase.tasks;
    const done = phaseTasks.filter(t => tasks[t.id]).length;
    return Math.round((done / phaseTasks.length) * 100);
  };

  const active = phases.find(p => p.id === activePhase);

  return (
    <div style={{
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
      background: "#0a0a0f",
      color: "#e2e8f0",
      minHeight: "100vh",
      padding: "32px 24px",
      maxWidth: 900,
      margin: "0 auto",
    }}>
      {/* Header */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <div style={{
            background: "linear-gradient(135deg, #6366f1, #22c55e)",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 2,
            color: "#fff",
          }}>ECOS V100 → V103</div>
          <div style={{ color: "#475569", fontSize: 12 }}>רודמאפ עבודה עם Claude</div>
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: -0.5 }}>
          מה לבנות ואיך לבקש מ-Claude
        </h1>
        <p style={{ color: "#64748b", fontSize: 13, marginTop: 6 }}>
          כל פאזה = prompt מוכן שאפשר להעתיק ולהדביק לסשן חדש
        </p>
      </div>

      {/* Moat Strength */}
      <div style={{
        border: "1px solid #1e293b",
        borderRadius: 12,
        padding: 20,
        marginBottom: 32,
        background: "#0f172a",
      }}>
        <div style={{ fontSize: 11, color: "#475569", letterSpacing: 2, marginBottom: 16 }}>INFRASTRUCTURE MOATS — מצב נוכחי</div>
        {moats.map(m => (
          <div key={m.label} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: m.color, fontWeight: 600 }}>{m.label}</span>
              <span style={{ fontSize: 11, color: "#475569" }}>{m.strength}%</span>
            </div>
            <div style={{ background: "#1e293b", borderRadius: 4, height: 6, overflow: "hidden" }}>
              <div style={{
                width: `${m.strength}%`,
                height: "100%",
                background: m.color,
                borderRadius: 4,
                transition: "width 0.6s ease",
              }} />
            </div>
            <div style={{ fontSize: 11, color: "#334155", marginTop: 3 }}>{m.desc}</div>
          </div>
        ))}
      </div>

      {/* Phase Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 32 }}>
        {phases.map(phase => {
          const prog = getProgress(phase);
          const isActive = activePhase === phase.id;
          return (
            <div
              key={phase.id}
              onClick={() => setActivePhase(isActive ? null : phase.id)}
              style={{
                border: `1px solid ${isActive ? phase.color : phase.borderColor}`,
                borderRadius: 12,
                padding: 18,
                cursor: "pointer",
                background: isActive ? phase.bgColor : "#0f172a",
                transition: "all 0.2s ease",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div style={{
                position: "absolute", top: 0, left: 0, right: 0, height: 3,
                background: phase.color, opacity: isActive ? 1 : 0.4,
              }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                <span style={{ fontSize: 10, color: phase.color, letterSpacing: 2, fontWeight: 700 }}>
                  {phase.timeframe}
                </span>
                <span style={{ fontSize: 11, color: "#475569" }}>{prog}%</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: "#f1f5f9" }}>
                {phase.label}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>{phase.description}</div>
              <div style={{ background: "#1e293b", borderRadius: 3, height: 4, overflow: "hidden" }}>
                <div style={{
                  width: `${prog}%`, height: "100%",
                  background: phase.color, borderRadius: 3,
                }} />
              </div>
              <div style={{ marginTop: 10 }}>
                {phase.tasks.map(t => (
                  <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}
                    onClick={e => { e.stopPropagation(); toggleTask(t.id); }}>
                    <div style={{
                      width: 14, height: 14, borderRadius: 3,
                      border: `1px solid ${tasks[t.id] ? phase.color : "#334155"}`,
                      background: tasks[t.id] ? phase.color : "transparent",
                      flexShrink: 0, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {tasks[t.id] && <span style={{ color: "#fff", fontSize: 9, lineHeight: 1 }}>✓</span>}
                    </div>
                    <span style={{
                      fontSize: 11,
                      color: tasks[t.id] ? "#475569" : "#94a3b8",
                      textDecoration: tasks[t.id] ? "line-through" : "none",
                    }}>{t.text}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Prompt Panel */}
      {active && (
        <div style={{
          border: `1px solid ${active.borderColor}`,
          borderRadius: 12,
          background: "#0f172a",
          overflow: "hidden",
          marginBottom: 32,
        }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "14px 20px",
            borderBottom: "1px solid #1e293b",
            background: active.bgColor,
          }}>
            <div>
              <span style={{ fontSize: 11, color: active.color, fontWeight: 700, letterSpacing: 1 }}>
                PROMPT ל-Claude — {active.label}
              </span>
              <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>
                העתק → שיחה חדשה עם Claude → העלה את הZIP → הדבק את הprompt
              </div>
            </div>
            <button
              onClick={() => copyPrompt(active.prompt)}
              style={{
                background: copied ? "#22c55e" : active.color,
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "6px 14px",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                transition: "background 0.2s",
                fontFamily: "inherit",
              }}
            >
              {copied ? "✓ הועתק" : "העתק Prompt"}
            </button>
          </div>
          <pre style={{
            margin: 0,
            padding: 20,
            fontSize: 11,
            lineHeight: 1.7,
            color: "#94a3b8",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 420,
            overflowY: "auto",
            direction: "ltr",
            textAlign: "left",
          }}>{active.prompt}</pre>
        </div>
      )}

      {/* How to work with Claude */}
      <div style={{
        border: "1px solid #1e293b",
        borderRadius: 12,
        padding: 20,
        background: "#0f172a",
      }}>
        <div style={{ fontSize: 11, color: "#475569", letterSpacing: 2, marginBottom: 16 }}>
          איך לעבוד נכון עם Claude על ECOS
        </div>
        {[
          ["1. סשן = פאזה אחת", "אל תנסה לעשות P0+P1 בסשן אחד. כל פאזה = שיחה חדשה עם Claude."],
          ["2. תמיד העלה את הZIP", "בתחילת כל שיחה: העלה ECOS_FINAL_vXXX_canonical.zip. Claude קורא את CLAUDE_CONTEXT.md קודם."],
          ["3. Sacred Files = קו אדום", "אם Claude מציע לשנות lib/fiatLedger.js או lib/auditLog.js — עצור אותו. תמיד."],
          ["4. טסטים קודם לכל", "בסוף כל שינוי: בקש 'הרץ npm test וודא שכל הטסטים עוברים'. Claude לא ישחרר קוד שבור."],
          ["5. NEXT_SESSION_PROMPT.md", "Claude מעדכן קובץ זה בכל גרסה. תמיד בקש שיעדכן אותו לפני הסיום."],
          ["6. bump version בכל פאזה", "P0=V101, P1=V101, P2=V102, P3=V103. כך אפשר לחזור לגרסה קודמת."],
        ].map(([title, desc]) => (
          <div key={title} style={{ display: "flex", gap: 12, marginBottom: 14 }}>
            <span style={{ color: "#6366f1", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{title}</span>
            <span style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>{desc}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, textAlign: "center", color: "#334155", fontSize: 10, letterSpacing: 1 }}>
        ECOS ROADMAP TOOL · לחץ על פאזה לפתוח את הprompt · לחץ על checkbox להסמן ביצוע
      </div>
    </div>
  );
}
