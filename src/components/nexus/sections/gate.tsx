"use client";

/**
 * 117p — GATE · שער-החיבור-הריבוני
 * connect (התחברות-מפתחות-המפעיל: הדבקה → אימות-מול-השרשרת → כספת-first → נשאר-מחובר)
 * agents (צירוף-סוכנים-דרך-API: טוקן · הודעות · משימות-לבנות · אישור-מפעיל)
 * 117p5c — גיבור-חשבון עם-טבעת-זהות · שב-מגן-מלא 8/8 · כפתור-ספינר · מצבי-ריק-אחידים
 * 117p8-R13 — קליטת-מפתחות-חיילים לפי-שם → הכספת (מנדט-מפעיל: "מקום-לטעות-מפתחות-חיילים")
 */

import { useState } from "react";
import { Bot, Copy, Inbox, KeyRound, Link2, Loader2, PlugZap, Send, ShieldCheck, CheckCircle2, XCircle, ListChecks, UserPlus } from "lucide-react";
import { useLive } from "@/hooks/use-live";
import { cn } from "@/lib/utils";
import { Chip, EmptyState, Micro, Panel, SecHead, Stat } from "../primitives";
import { FleetV3Panel } from "./fleetv3";

type GateResp = {
  ok?: boolean;
  account?: string;
  connected?: boolean;
  connectedAt?: string | null;
  headEntry?: boolean;
  live?: { steem: Record<string, boolean> | null; hive: Record<string, boolean> | null };
  soldiers?: number;
  fleet?: {
    auditedAt?: string;
    total?: number;
    hiveFull?: number;
    viaHead?: string[];
    dead?: string[];
    rails?: { steemAttest?: string; hiveAnchor?: string };
    refresh?: string;
  } | null;
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
const GATE_ROLES = ["owner", "active", "posting", "memo"] as const; // לתצוגת-כיסוי-ברוטת-החיילים

/* טבעת-זהות — גרדיאנט-דטרמיניסטי משם-החשבון (בלי-תמונות, אפס-רשת) */
function identityHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}
function IdentityRing({ name, ok }: { name: string; ok: boolean }) {
  const hue = identityHue(name);
  return (
    <div
      aria-hidden
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 p-[2px] transition-shadow"
      style={{
        borderColor: ok ? "rgba(16,185,129,0.65)" : `hsl(${hue} 45% 45% / 0.6)`,
        boxShadow: ok ? "0 0 18px -2px rgba(16,185,129,0.55)" : `0 0 14px -4px hsl(${hue} 60% 50% / 0.5)`,
      }}
    >
      <span
        dir="ltr"
        className="flex h-full w-full items-center justify-center rounded-full text-sm font-black text-white"
        style={{ background: `linear-gradient(135deg, hsl(${hue} 55% 30%), hsl(${(hue + 40) % 360} 55% 22%))` }}
      >
        {(name[0] || "?").toUpperCase()}
      </span>
    </div>
  );
}

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
  const liveRows = [g?.live?.steem, g?.live?.hive].filter(Boolean) as Record<string, boolean>[];
  const checkedCount = liveRows.reduce((n, r) => n + Object.keys(r).length, 0);
  const okCount = liveRows.reduce((n, r) => n + Object.values(r).filter(Boolean).length, 0);
  const fullShield = checkedCount > 0 && okCount === checkedCount;
  return (
    <div className="space-y-4">
      <Panel className="p-4 md:p-5">
        <SecHead
          icon={<PlugZap className="h-4 w-4" />}
          title="מצב-החיבור-הריבוני"
          sub="חי-מהשרשרת · הכספת-המקומית מול-הסמכויות-האמת"
          extra={g?.connected ? <Chip tone="emerald">מחובר</Chip> : <Chip tone="amber">לא-מחובר</Chip>}
        />
        {g?.account && (
          <div className="mb-3 flex items-center gap-3 rounded-lg border border-zinc-800/80 bg-gradient-to-l from-emerald-500/[0.06] to-transparent p-3">
            <IdentityRing name={g.account} ok={!!g.connected} />
            <div className="min-w-0 flex-1">
              <div dir="ltr" className="truncate font-mono text-lg font-bold text-zinc-100">@{g.account}</div>
              <div className="text-[11px] text-zinc-500">
                {g.connectedAt ? "מחובר-מאז " + new Date(g.connectedAt).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "חשבון-הבית-הריבוני"}
                {g.headEntry ? " · חתום-בראש-הספר" : ""}
              </div>
            </div>
            {fullShield && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-bold text-emerald-300 shadow-[0_0_16px_-4px_rgba(16,185,129,0.5)]">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                מגן-מלא {okCount}/{checkedCount}
              </span>
            )}
          </div>
        )}
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
        {g?.fleet && (
          <div className="mt-3 rounded-md border border-zinc-800/70 bg-zinc-950/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-zinc-300">מלאות-הצי (ביקורת-אימות-מול-השרשרת)</span>
              <span dir="ltr" className="font-mono text-[10px] text-zinc-600">
                {g.fleet.auditedAt ? new Date(g.fleet.auditedAt).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : ""}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono", (g.fleet.hiveFull ?? 0) >= (g.fleet.total ?? 1) - 1 ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300")}>
                <CheckCircle2 className="h-3 w-3" aria-hidden />
                Hive-מלא {g.fleet.hiveFull}/{g.fleet.total}
              </span>
              {(g.fleet.viaHead || []).length > 0 && (
                <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-emerald-300">
                  <Link2 className="h-3 w-3" aria-hidden />
                  דרך-הראש: {g.fleet.viaHead.join(", ")}
                </span>
              )}
              {(g.fleet.dead || []).map((d) => (
                <span key={d} className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 font-mono text-rose-300">
                  <XCircle className="h-3 w-3" aria-hidden />@{d}
                </span>
              ))}
            </div>
            <Micro className="mt-2 block">
              מסילות-חיות (הוכח-117p6): עיגון-Steem בראש · attests ל-ynet-דרך-הראש · עיגון-Hive צי+דרך-הראש. מפתחות-Steem-מקוריים (2018) אצל-המפעיל — soldier_repair.cjs משלים-מיידית-בהמסרם.
            </Micro>
          </div>
        )}
        {g?.backup?.file && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-zinc-800/70 bg-zinc-950/60 px-3 py-2">
            <div className="min-w-0 text-[11px] text-zinc-500">
              גיבוי-אסון: <span dir="ltr" className="font-mono text-zinc-400">{g.backup.file}</span>
              <span dir="ltr" className="hidden font-mono text-zinc-600 md:inline"> · {g.backup.sha256?.slice(0, 12)}…</span>
              <span className="md:hidden"> · סיסמה-אצלך</span>
            </div>
            <span className="shrink-0 font-mono text-[10px] text-zinc-600">0600 · gitignored</span>
          </div>
        )}
        <Micro className="mt-3 block">
          החיבור-נשמר-מקומית (gate-state · vault · .env — אפס-גיט). המפתחות-לעולם-לא-חוזרים-בתשובה.
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
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-emerald-500/50 bg-emerald-500/15 px-4 py-2 text-sm font-bold text-emerald-200 transition-all hover:bg-emerald-500/25 active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
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

      <SoldierIntake />

      <FleetV3Panel />
    </div>
  );
}

/* ── soldier-intake (117p8-R13) ── */
type SoldierResp = {
  ok?: boolean;
  roster?: Array<{
    name: string;
    tier?: string;
    chains?: Record<string, Record<string, boolean>>;
    intakeAt?: string | null;
    rolesTotal?: number;
  }>;
  fleetNames?: string[];
  seal?: { enc: boolean; meta: boolean };
  error?: string;
};

type SoldierPostResp = {
  ok?: boolean;
  name?: string;
  verified?: { steem: Record<string, boolean>; hive: Record<string, boolean> };
  merged?: { steem: string[]; hive: string[] };
  rolesInVault?: Array<{ chain: string; roles: string[] }>;
  persisted?: string[];
  nextStep?: string | null;
  error?: string;
  verify?: { steem: Record<string, boolean>; hive: Record<string, boolean> };
};

function SoldierIntake() {
  const live = useLive<SoldierResp>("/api/ops/gate/soldier", 10000);
  const [name, setName] = useState("");
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SoldierPostResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setRes(null);
    setErr(null);
    try {
      const r = await fetch("/api/ops/gate/soldier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, paste }),
      });
      const j = (await r.json()) as SoldierPostResp;
      if (j.ok) {
        setRes(j);
        setPaste("");
      } else {
        setErr(j.error || "נכשל");
        setRes(j);
      }
    } catch (e) {
      setErr("שגיאת-רשת: " + String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  };

  const roster = live.data?.roster || [];
  const fleetNames = live.data?.fleetNames || [];
  return (
    <Panel className="p-4 md:p-5">
      <SecHead
        icon={<UserPlus className="h-4 w-4" />}
        title="קליטת-מפתחות-חיילים — לפי-שם"
        sub="בחר/הקלד-שם-חייל · הדבק-גיליון · אימות-מול-השרשרת-החיה-שלו · ישר-לכספת+איטום"
        extra={<Chip tone="violet">{roster.length} בכספת</Chip>}
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          dir="ltr"
          list="soldier-names"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9\-.]/g, ""))}
          placeholder="שם-החייל (למשל cashmachine)"
          aria-label="שם-חייל-לקליטה"
          className="min-h-[44px] w-full rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-2 font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-violet-500/50 sm:w-64"
        />
        <datalist id="soldier-names">
          {fleetNames.map((n) => (
            <option key={n} value={n} />
          ))}
          {roster.map((r) => (
            <option key={r.name} value={r.name} />
          ))}
        </datalist>
      </div>
      <textarea
        dir="ltr"
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        rows={5}
        spellCheck={false}
        aria-label="גיליון-מפתחות-החייל"
        placeholder={"OWNER   = 5H…\nACTIVE  = 5K…\nPOSTING = 5J…\nMEMO    = 5H…\nHIVE\nOWNER   = 5K…\nACTIVE  = 5J…\nPOSTING = 5K…\nMEMO    = 5H…"}
        className="mt-2 w-full rounded-md border border-zinc-800 bg-zinc-950/80 p-3 font-mono text-xs text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-violet-500/50"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={submit}
          disabled={busy || !name.trim() || !paste.trim()}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-violet-500/50 bg-violet-500/15 px-4 py-2 text-sm font-bold text-violet-200 transition-all hover:bg-violet-500/25 active:scale-[0.98] disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
          {busy ? "מאמת-מול-השרשרת…" : "קלוט-לכספת"}
        </button>
        <Micro>אותם-חוקי-זהב: לא-שומרים-מת · מיזוג-בלי-מחיקה · אפס-שידור · אפס-גיט · איטום-מיידי-אחרי-כתיבה</Micro>
      </div>
      {err && (
        <div role="alert" className="mt-3 space-y-2 rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          <div>{err}</div>
          {res && !res.ok && res.verify && (res.verify.steem || res.verify.hive) && (
            <>
              <VerifyRow label="Steem" row={res.verify.steem ?? null} />
              <VerifyRow label="Hive" row={res.verify.hive ?? null} />
            </>
          )}
        </div>
      )}
      {res?.ok && res.verified && (
        <div role="status" className="mt-3 space-y-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3">
          <div className="text-sm font-bold text-emerald-200">@{res.name} נקלט-לכספת ✓</div>
          <VerifyRow label="Steem" row={res.verified.steem ?? null} />
          <VerifyRow label="Hive" row={res.verified.hive ?? null} />
          <div dir="ltr" className="font-mono text-[10px] text-emerald-400/80">
            {(res.persisted || []).join(" · ")}
          </div>
          {res.nextStep && (
            <div dir="ltr" className="overflow-x-auto rounded border border-emerald-500/30 bg-zinc-950/60 p-2 font-mono text-[10px] text-emerald-300">
              {res.nextStep}
            </div>
          )}
        </div>
      )}
      {roster.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-xs font-bold text-zinc-300">רוטת-הכספת (לפי-חייל · אפס-סודות — כיסוי-תפקידים-בלבד)</div>
          <div className="max-h-72 space-y-1.5 overflow-y-auto nexus-scroll pr-1">
            {roster.map((s) => (
              <div key={s.name} className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2">
                <button
                  onClick={() => setName(s.name)}
                  dir="ltr"
                  className="font-mono text-xs font-bold text-zinc-200 hover:text-violet-300"
                  title="לחץ-למילוי-שם"
                >
                  @{s.name}
                </button>
                {s.tier === "operator" && <Chip tone="amber">operator</Chip>}
                {("steem" in (s.chains || {}) ? ["steem"] : []).map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800/50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                    {c}: {GATE_ROLES.filter((r) => s.chains?.[c]?.[r]).length}/4
                  </span>
                ))}
                {("hive" in (s.chains || {}) ? ["hive"] : []).map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800/50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                    {c}: {GATE_ROLES.filter((r) => s.chains?.[c]?.[r]).length}/4
                  </span>
                ))}
                <span dir="ltr" className="ms-auto font-mono text-[10px] text-zinc-600">
                  {s.rolesTotal ?? 0} מפתחות
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
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
        <div className="max-h-96 space-y-1.5 overflow-y-auto nexus-scroll pr-1" aria-label="תיבת-הודעות-סוכנים">
          {(live.data?.inbox || []).map((m, i) => (
            <div key={i} className="rise-in rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs transition-colors hover:border-zinc-700">
              <div className="flex items-center justify-between gap-2">
                <span dir="ltr" className="font-mono font-bold text-violet-300">{m.from || "agent"}</span>
                <span dir="ltr" className="font-mono text-[10px] text-zinc-600">{m.at ? new Date(m.at).toLocaleTimeString("en-GB") : ""}</span>
              </div>
              <p className="mt-1 break-words text-zinc-300">{m.text}</p>
            </div>
          ))}
          {!(live.data?.inbox || []).length && (
            <EmptyState tone="violet" icon={<Inbox className="h-5 w-5" />} title="אין-הודעות-עדיין" sub="הסוכן-הראשון-מוזמן — רשום-סוכן למעלה או שלח-curl מהמכונה-שלך" />
          )}
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
        <div className="max-h-96 space-y-1.5 overflow-y-auto nexus-scroll pr-1">
          {(live.data?.tasks || []).map((t, i) => (
            <div key={i} className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs transition-colors hover:border-zinc-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span dir="ltr" className="font-mono text-zinc-300">{t.from}/{t.command}</span>
                <span className={cn("inline-flex items-center gap-1 font-mono text-[10px]", t.status === "done" || t.status === "auto" ? "text-emerald-300" : t.status === "pending" ? "text-amber-300" : "text-rose-300")}>
                  {t.status === "done" || t.status === "auto" ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : t.status === "pending" ? <ListChecks className="h-3 w-3" aria-hidden /> : <XCircle className="h-3 w-3" aria-hidden />}
                  {t.status}
                </span>
              </div>
              {t.result && <p dir="ltr" className="mt-1 break-words font-mono text-[10px] text-zinc-500">{t.result}</p>}
              {t.status === "pending" && (
                <div className="mt-1.5 flex gap-1.5">
                  <button onClick={() => act(t.id, "approve")} className="min-h-[32px] rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-300 transition-colors hover:bg-emerald-500/20">אשר-ובצע</button>
                  <button onClick={() => act(t.id, "reject")} className="min-h-[32px] rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[10px] font-bold text-rose-300 transition-colors hover:bg-rose-500/20">דחה</button>
                </div>
              )}
            </div>
          ))}
          {!(live.data?.tasks || []).length && (
            <EmptyState tone="emerald" icon={<ListChecks className="h-5 w-5" />} title="אין-משימות" sub="משימת-קריאה (status · capabilities) רצה-מיד · שאר-ממתין-לאישורך" />
          )}
        </div>
      </Panel>
    </div>
  );
}

export function GateSec({ sub }: { sub: string }) {
  return sub === "agents" ? <Agents /> : <Connect />;
}


