"use client";

/**
 * 117p — GATE · שער-החיבור-הריבוני
 * connect (התחברות-מפתחות-המפעיל: הדבקה → אימות-מול-השרשרת → כספת-first → נשאר-מחובר)
 * agents (צירוף-סוכנים-דרך-API: טוקן · הודעות · משימות-לבנות · אישור-מפעיל)
 */

import { useState } from "react";
import { Bot, Copy, KeyRound, Link2, PlugZap, Send, ShieldCheck, CheckCircle2, XCircle } from "lucide-react";
import { useLive } from "@/hooks/use-live";
import { cn } from "@/lib/utils";
import { Chip, Micro, Panel, SecHead, Stat } from "../primitives";

type GateResp = {
  ok?: boolean;
  account?: string;
  connected?: boolean;
  connectedAt?: string | null;
  headEntry?: boolean;
  live?: { steem: Record<string, boolean> | null; hive: Record<string, boolean> | null };
  soldiers?: number;
  seal?: { enc: boolean; meta: boolean };
  broker?: boolean;
  guardianAgeS?: number | null;
  backup?: { file: string; sha256: string };
  error?: string;
};

type AgentsResp = {
  ok?: boolean;
  token?: string;
  agents?: Array<{ name?: string; capabilities?: string[]; at?: string; status?: string }>;
  inbox?: Array<{ at?: string; from?: string; text?: string }>;
  tasks?: Array<{ id?: string; at?: string; from?: string; command?: string; status?: string; result?: string }>;
};

const ROLE_HE: Record<string, string> = { owner: "בעלים", active: "פעיל", posting: "פוסטינג", memo: "מזכר", _all: "הכל" };

function VerifyRow({ label, row }: { label: string; row: Record<string, boolean> | null }) {
  if (!row) return <div className="flex items-center gap-2 text-xs text-zinc-600">{label}: <Chip tone="zinc">לא-נמדד</Chip></div>;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="min-w-[52px] font-semibold text-zinc-300">{label}</span>
      {Object.entries(row).map(([k, v]) => (
        <span
          key={k}
          dir="ltr"
          className={cn(
            "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px]",
            v ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-rose-500/40 bg-rose-500/10 text-rose-300"
          )}
        >
          {v ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <XCircle className="h-3 w-3" aria-hidden />}
          {ROLE_HE[k] || k}
        </span>
      ))}
    </div>
  );
}

/* ── connect ── */
function Connect() {
  const gate = useLive<GateResp>("/api/ops/gate", 8000);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const connect = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/ops/gate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paste }) });
      const j = (await r.json()) as { ok?: boolean; error?: string; verified?: { steem: Record<string, boolean>; hive: Record<string, boolean> } };
      if (j.ok) {
        setMsg({ ok: true, text: "חוברנו — המפתחות אומתו-מול-השרשרת ונשמרו-בכספת (vault-first) · נשארים-מחוברים" });
        setPaste("");
        
      } else {
        setMsg({ ok: false, text: j.error || "נכשל" });
      }
    } catch (e) {
      setMsg({ ok: false, text: "שגיאת-רשת: " + String((e as Error).message || e) });
    } finally {
      setBusy(false);
    }
  };

  const g = gate.data;
  return (
    <div className="space-y-4">
      <Panel className="p-4 md:p-5">
        <SecHead
          icon={<PlugZap className="h-4 w-4" />}
          title="מצב-החיבור-הריבוני"
          sub="חי-מהשרשרת · הכספת-המקומית מול-הסמכויות-האמת"
          extra={g?.connected ? <Chip tone="emerald">מחובר</Chip> : <Chip tone="amber">לא-מחובר</Chip>}
        />
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <Stat label="חשבון-הבית" value={g?.account ? "@" + g.account : "—"} />
          <Stat label="חיילים-בכספת" value={g?.soldiers ?? "—"} tone="emerald" />
          <Stat label="שער-החתימה" value={g?.broker ? "חי" : "—"} tone={g?.broker ? "emerald" : "amber"} />
          <Stat label="גרדיאן" value={g?.guardianAgeS != null ? g.guardianAgeS + "s" : "—"} tone={g?.guardianAgeS != null && g.guardianAgeS < 180 ? "emerald" : "amber"} />
        </div>
        <div className="mt-3 space-y-1.5">
          <VerifyRow label="Steem" row={g?.live?.steem ?? null} />
          <VerifyRow label="Hive" row={g?.live?.hive ?? null} />
        </div>
        <Micro className="mt-3 block">
          החיבור-נשמר-מקומית (gate-state · vault · .env — אפס-גיט). גיבוי-אסון מוצפן: <span dir="ltr" className="font-mono">{g?.backup?.file}</span> — סיסמה-אצל-המפעיל בלבד.
        </Micro>
      </Panel>

      <Panel className="p-4 md:p-5">
        <SecHead icon={<KeyRound className="h-4 w-4" />} title="התחברות-עם-המפתחות" sub="הדבק-גיליון-מפתחות (OWNER = 5H… · מקטע HIVE אופציונלי) — אימות-מול-השרשרת-לפני-שמירה" />
        <textarea
          dir="ltr"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={5}
          spellCheck={false}
          aria-label="הדבקת-מפתחות"
          placeholder={"OWNER   = 5H…\nACTIVE  = 5K…\nPOSTING = 5J…\nMEMO    = 5H…\nHIVE\nOWNER   = 5K…"}
          className="w-full rounded-md border border-zinc-800 bg-zinc-950/80 p-3 font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-emerald-500/50"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={connect}
            disabled={busy || !paste.trim()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-emerald-500/50 bg-emerald-500/15 px-4 py-2 text-sm font-bold text-emerald-200 transition-colors hover:bg-emerald-500/25 disabled:opacity-40"
          >
            <Link2 className="h-4 w-4" aria-hidden />
            {busy ? "מאמת-מול-השרשרת…" : "חבר-ואמת"}
          </button>
          <Micro>אפס-שידור · אפס-גיט · לא-נשמר-מפתח-מת · המפתחות-לעולם-לא-חוזרים-בתשובה</Micro>
        </div>
        {msg && (
          <div role="status" className={cn("mt-3 rounded-md border p-3 text-sm", msg.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-rose-500/40 bg-rose-500/10 text-rose-200")}>
            {msg.text}
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ── agents ── */
function Agents() {
  const live = useLive<AgentsResp>("/api/agents", 6000);
  const [copied, setCopied] = useState(false);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(live.data?.token || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (_) {}
  };

  const registerSelf = async () => {
    if (!name.trim()) return;
    const r = await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json", "x-agent-token": live.data?.token || "" }, body: JSON.stringify({ action: "register", name, capabilities: ["chat", "task"] }) });
    const j = (await r.json()) as { ok?: boolean; error?: string };
    setNote(j.ok ? "סוכן " + name + " נרשם" : j.error || "נכשל");
    if (j.ok) { setName("");  }
  };

  const operatorNote = async () => {
    if (!text.trim()) return;
    const r = await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "message", from: "operator", text }) });
    const j = (await r.json()) as { ok?: boolean };
    setNote(j.ok ? "ההודעה-בתיבה" : "נכשל");
    if (j.ok) { setText("");  }
  };

  const act = async (id: string | undefined, action: "approve" | "reject") => {
    if (!id) return;
    await fetch("/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) });
    
  };

  return (
    <div className="space-y-4">
      <Panel className="p-4 md:p-5">
        <SecHead icon={<Bot className="h-4 w-4" />} title="צירוף-סוכנים-דרך-API" sub="כל-סוכן-שהוא: רישום · כתיבה-למפעיל · משימות-קריאה-מאושרות · אפס-מפתחות" extra={<Chip tone="violet">{live.data?.agents?.length ?? 0} מחוברים</Chip>} />
        <div className="flex flex-wrap items-center gap-2">
          <code dir="ltr" className="min-w-0 flex-1 truncate rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-2 font-mono text-xs text-zinc-300">
            {live.data?.token ? live.data.token.slice(0, 10) + "…" + live.data.token.slice(-6) : "—"}
          </code>
          <button onClick={copyToken} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-300 hover:text-zinc-100">
            <Copy className="h-3.5 w-3.5" aria-hidden />
            {copied ? "הועתק" : "העתק-טוקן"}
          </button>
        </div>
        <pre dir="ltr" className="mt-3 overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950/80 p-3 font-mono text-[11px] leading-relaxed text-zinc-400">
{`# צירוף-סוכן-חדש (מכל-מכונה):
curl -X POST <base>/api/agents -H 'Content-Type: application/json' \\
  -H 'x-agent-token: THE-TOKEN' \\
  -d '{"action":"register","name":"my-agent","capabilities":["chat","task"]}'
# כתיבה-למפעיל:
curl -X POST <base>/api/agents -H 'x-agent-token: THE-TOKEN' \\
  -H 'Content-Type: application/json' \\
  -d '{"action":"message","from":"my-agent","text":"שלום-מהסוכן"}'
# משימה (read-only-whitelist רץ-מיד · שאר-ממתין-לאישור-מפעיל):
curl -X POST <base>/api/agents -H 'x-agent-token: THE-TOKEN' \\
  -H 'Content-Type: application/json' \\
  -d '{"action":"task","from":"my-agent","command":"status"}'`}
        </pre>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם-סוכן-לרישום-מהיר" dir="ltr" className="min-h-[44px] min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-2 font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-emerald-500/50" />
          <button onClick={registerSelf} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-violet-500/50 bg-violet-500/15 px-3 py-2 text-xs font-bold text-violet-200 hover:bg-violet-500/25">
            <Bot className="h-3.5 w-3.5" aria-hidden /> רשום-סוכן
          </button>
        </div>
        {note && <Micro className="mt-2 block">{note}</Micro>}
      </Panel>

      <Panel className="p-4 md:p-5">
        <SecHead icon={<Send className="h-4 w-4" />} title="תיבת-הסוכנים" sub="הודעות-חיות-מהסוכנים-שלנו" extra={<Chip tone="emerald">{live.data?.inbox?.length ?? 0}</Chip>} />
        <div className="max-h-72 space-y-1.5 overflow-y-auto nexus-scroll pr-1" aria-label="תיבת-הודעות-סוכנים">
          {(live.data?.inbox || []).map((m, i) => (
            <div key={i} className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span dir="ltr" className="font-mono font-bold text-violet-300">{m.from || "agent"}</span>
                <span dir="ltr" className="font-mono text-[10px] text-zinc-600">{m.at ? new Date(m.at).toLocaleTimeString("en-GB") : ""}</span>
              </div>
              <p className="mt-1 break-words text-zinc-300">{m.text}</p>
            </div>
          ))}
          {!(live.data?.inbox || []).length && <Micro>אין-הודעות-עדיין — הסוכן-הראשון-מוזמן</Micro>}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="הודעת-מפעיל-לתיבה (לסוכנים-לקרוא)" className="min-h-[44px] min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-emerald-500/50" />
          <button onClick={operatorNote} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/25">
            <Send className="h-3.5 w-3.5" aria-hidden /> שלח
          </button>
        </div>
      </Panel>

      <Panel className="p-4 md:p-5">
        <SecHead icon={<ShieldCheck className="h-4 w-4" />} title="משימות-סוכנים" sub="לבנות-לקריאה=רץ-מיד · שאר-ממתין-לאישורך" extra={<Chip tone="amber">{(live.data?.tasks || []).filter((t) => t.status === "pending").length} ממתינות</Chip>} />
        <div className="max-h-72 space-y-1.5 overflow-y-auto nexus-scroll pr-1">
          {(live.data?.tasks || []).map((t, i) => (
            <div key={i} className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span dir="ltr" className="font-mono text-zinc-300">{t.from}/{t.command}</span>
                <span className={cn("font-mono text-[10px]", t.status === "done" || t.status === "auto" ? "text-emerald-300" : t.status === "pending" ? "text-amber-300" : "text-rose-300")}>{t.status}</span>
              </div>
              {t.result && <p dir="ltr" className="mt-1 break-words font-mono text-[10px] text-zinc-500">{t.result}</p>}
              {t.status === "pending" && (
                <div className="mt-1.5 flex gap-1.5">
                  <button onClick={() => act(t.id, "approve")} className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/20">אשר-ובצע</button>
                  <button onClick={() => act(t.id, "reject")} className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[10px] font-bold text-rose-300 hover:bg-rose-500/20">דחה</button>
                </div>
              )}
            </div>
          ))}
          {!(live.data?.tasks || []).length && <Micro>אין-משימות</Micro>}
        </div>
      </Panel>
    </div>
  );
}

export function GateSec({ sub }: { sub: string }) {
  return sub === "agents" ? <Agents /> : <Connect />;
}


