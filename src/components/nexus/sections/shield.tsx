"use client";

/**
 * 117n — SHIELD · המגן-מסך-מלא
 * posture (תמונה-מצטברת) · scanner (כלי-בדיקה-חי-מול-המנוע-האמת!) · audit (זרם-ביקורת-חי)
 */

import { useState } from "react";
import { motion } from "framer-motion";
import { Radar, ScanLine, ShieldCheck, XCircle } from "lucide-react";
import { useLive } from "@/hooks/use-live";
import { cn } from "@/lib/utils";
import { Chip, Micro, Panel, SecHead, Stat, ago, fmtInt, mask } from "../primitives";
import type { NexusData } from "@/hooks/use-nexus";

/* ── posture — התמונה-המצטברת (הירושה-מ-117m) ── */
const THREATS = [
  { id: "T1", name: "טוקנים-מתחזים", d: "שם-מפורסם מחוזה-זר · תווים-מטעים · דצימלים-חריגים" },
  { id: "T2", name: "חוזים-זדוניים", d: "14-סלקטורי-טיהור ב-bytecode (mint/setOwner/blacklist/pause)" },
  { id: "T3", name: "חיקוי-דלת", d: "vanity-gen של קידומת/ראש+זנב מול 20-הדלתות שלנו" },
  { id: "T4", name: "אישור-לא-מוגבל", d: "approve(max)/setApprovalForAll = דלת-כיס-פתוחה → BLOCK" },
  { id: "T5", name: "ממו-פישינג", d: "דומייני-חיקוי-מותג · מילות-גיוס · צורת-סודות" },
  { id: "T6", name: "רעש-מהירות", d: "relay-spam ששורף רוחב-פס — ledger 10-דק'" },
];

function Posture({ data }: { data: NexusData }) {
  const s = data.shield;
  return (
    <div className="space-y-4">
      <Panel className="p-4 md:p-6">
        <SecHead icon={<ShieldCheck className="h-4 w-4" />} title="THE-SHIELD · מגן-הגנבים" sub="מנוע-ההגנה-רב-שרשרתי · אפס-מפתחות · אין-אמת-חלקית" extra={<Chip tone="emerald">ARMED</Chip>} />
        <div className="grid grid-cols-3 gap-4 md:grid-cols-6">
          <Stat label="בדיקות-מצטבר" value={fmtInt(s.stats.checks || 0)} />
          <Stat label="חסימות" value={fmtInt(s.stats.blocks || 0)} tone="rose" />
          <Stat label="אזהרות" value={fmtInt(s.stats.warns || 0)} tone="amber" />
          <Stat label="דלתות-מוגנות" value="20" sub="8-broker + 12-רישום" tone="emerald" />
          <Stat label="רשימת-אסורים" value={fmtInt(s.deny.length)} sub="נלמד-מהחיים" tone="violet" />
          <Stat label="מהירות-ריליי" value={fmtInt(s.velocity) + "/10m"} sub="ledger-חי" />
        </div>
        <div className="mt-4 rounded-md border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5 text-[11px] leading-relaxed text-emerald-200/90">
          <span className="font-bold">LIVE-FIRE PROVEN:</span> selftest 9/9 · חיקוי-דלת אמת (prefix-28) נחסם-BLOCK-80 · פריים-פישינג-חי נחסם-100 (5-נימוקים) · USDT-קאנוני-מאומת-ALLOW
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {THREATS.map((t, i) => (
          <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <Panel className="h-full p-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span dir="ltr" className="font-mono text-[10px] font-bold tracking-widest text-rose-400/80">{t.id}</span>
                <Chip tone="emerald">ENFORCED</Chip>
              </div>
              <div className="text-sm font-bold text-zinc-100">{t.name}</div>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{t.d}</p>
            </Panel>
          </motion.div>
        ))}
      </div>

      {s.deny.length > 0 && (
        <Panel className="p-4 md:p-5">
          <Micro className="mb-2">רשימת-האסורים-הנלמדת</Micro>
          <div dir="ltr" className="max-h-40 space-y-1 overflow-y-auto font-mono text-xs text-rose-300/90 nexus-scroll">
            {s.deny.map((a) => (
              <div key={a} className="flex items-center gap-2 rounded border border-rose-500/20 bg-rose-500/5 px-2 py-1">
                <XCircle className="h-3 w-3 shrink-0" aria-hidden />
                {mask(a, 14, 10)}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ── scanner — הכלי-החי: בדיקה-אמת-מול-המנוע ── */
type ShieldVerdict = { verdict?: string; score?: number; measured?: boolean; reasons?: string[]; name?: string; canonical?: boolean; mimicOf?: string; prefix?: number };
type ScanResp = { ok: boolean; mode: string; value: string; shield: ShieldVerdict; error?: string };

const MODES = [
  { id: "address", label: "כתובת-TRON", hint: "T…" },
  { id: "token", label: "טוקן-חוזה", hint: "TR7… (USDT)" },
  { id: "memo", label: "ממו/הודעה", hint: "טקסט" },
] as const;

const EXAMPLES: Record<string, string[]> = {
  address: ["TVkH6fqiaRj2k4MEkd8Rdefqod1D5zkhjL", "TVkH6fqiaRj2k4MEkd8Rdefqod1DDsreCv"],
  token: ["TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"],
  memo: ["visit http://saos-claim.xyz and enter your secret phrase", "שלום, עדכון-רשת רגיל"],
};

function Scanner() {
  const [mode, setMode] = useState<(typeof MODES)[number]["id"]>("address");
  const [value, setValue] = useState("");
  const [res, setRes] = useState<ScanResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (v?: string) => {
    const val = (v ?? value).trim();
    if (!val) return;
    if (v) setValue(v);
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      const r = await fetch("/api/shield-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, value: val }),
      });
      const j = (await r.json()) as ScanResp & { error?: string };
      if (!r.ok || !j.ok) setErr(j.error || "shield-unreachable");
      else setRes(j);
    } catch {
      setErr("network-fail");
    } finally {
      setBusy(false);
    }
  };

  const verdict = res?.shield?.verdict || "";
  const vTone = verdict === "BLOCK" ? "rose" : verdict === "WARN" ? "amber" : verdict === "ALLOW" ? "emerald" : "zinc";

  return (
    <div className="space-y-4">
      <Panel className="p-4 md:p-5">
        <SecHead icon={<ScanLine className="h-4 w-4" />} title="הבודק-החי · מול-המנוע-האמת" sub="כל-בדיקה=ריצת-מנוע-SHIELD-אמת-בתהליך-מבודד · אפס-סימולציה" extra={<Chip tone="emerald">TOOL</Chip>} />
        <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="מצב-בדיקה">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => { setMode(m.id); setRes(null); setErr(null); }}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all",
                mode === m.id ? "border-rose-500/50 bg-rose-500/10 text-rose-200" : "border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder={MODES.find((m) => m.id === mode)?.hint}
            dir="ltr"
            aria-label="קלט-לבדיקה"
            className="w-full rounded-md border border-zinc-800 bg-zinc-950/80 px-3 py-2.5 font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-rose-500/50 focus:outline-none"
          />
          <button onClick={() => run()} disabled={busy || !value.trim()} className="flex items-center justify-center gap-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-5 py-2.5 font-mono text-xs font-bold text-rose-200 transition-colors hover:bg-rose-500/20 disabled:opacity-40">
            <Radar className={cn("h-4 w-4", busy && "animate-spin")} aria-hidden />
            {busy ? "SCANNING…" : "SCAN"}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(EXAMPLES[mode] || []).map((ex) => (
            <button key={ex} onClick={() => run(ex)} dir="ltr" className="max-w-full truncate rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 font-mono text-[10px] text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-300">
              {ex.length > 34 ? mask(ex, 18, 10) : ex}
            </button>
          ))}
        </div>
      </Panel>

      {err && <Panel className="p-3 text-xs text-rose-300" corners={false}>שגיאה: {err}</Panel>}

      {res && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Panel className={cn("p-4 md:p-5", verdict === "BLOCK" && "border-rose-500/40", verdict === "WARN" && "border-amber-500/40", verdict === "ALLOW" && "border-emerald-500/40")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span dir="ltr" className={cn("font-mono text-2xl font-black tracking-wider", verdict === "BLOCK" ? "text-rose-300" : verdict === "WARN" ? "text-amber-300" : "text-emerald-300")}>
                  {verdict}
                </span>
                <Chip tone={vTone as "rose" | "amber" | "emerald" | "zinc"}>score {res.shield.score ?? 0}</Chip>
                <Chip ok={res.shield.measured === true}>{res.shield.measured ? "MEASURED" : "UNMEASURED"}</Chip>
              </div>
              <span dir="ltr" className="max-w-full truncate font-mono text-[10px] text-zinc-600">{mask(res.value, 22, 12)} · {res.mode}</span>
            </div>
            {(res.shield.reasons || []).length > 0 && (
              <ul dir="ltr" className="mt-3 space-y-1">
                {(res.shield.reasons || []).map((r, i) => (
                  <li key={i} className="rounded border border-zinc-800/60 bg-zinc-950/60 px-2.5 py-1.5 font-mono text-[11px] text-zinc-400">{r}</li>
                ))}
              </ul>
            )}
            {res.shield.mimicOf && (
              <p dir="ltr" className="mt-2 font-mono text-[11px] text-rose-300/90">mimic-of: {res.shield.mimicOf} {res.shield.prefix ? `(prefix ${res.shield.prefix})` : ""}</p>
            )}
          </Panel>
        </motion.div>
      )}
    </div>
  );
}

/* ── audit — זרם-הביקורת-החי (שתי-מערכות-ביקורת) ── */
type AuditEv = Record<string, unknown>;
type AuditResp = { ok: boolean; src: string; bytes: number; count: number; events: AuditEv[]; at: string };

function Audit() {
  const [src, setSrc] = useState<"shield" | "broker">("shield");
  const [verdict, setVerdict] = useState("");
  const live = useLive<AuditResp>(`/api/audit?src=${src}&n=80${verdict ? "&verdict=" + verdict : ""}`, 5000);
  const evs = live.data?.events || [];

  const vChip = (v: unknown) => {
    const s = String(v || "");
    if (/BLOCK|DENY/.test(s)) return <Chip tone="rose">{s}</Chip>;
    if (/WARN/.test(s)) return <Chip tone="amber">{s}</Chip>;
    if (/ALLOW/.test(s)) return <Chip tone="emerald">{s}</Chip>;
    return <Chip>{s || "—"}</Chip>;
  };

  return (
    <div className="space-y-4">
      <Panel className="p-4 md:p-5">
        <SecHead
          icon={<ScanLine className="h-4 w-4" />}
          title="זרם-הביקורת-החי"
          sub={src === "shield" ? "security-events.jsonl · כל-בדיקת-מגן-מוקלטת" : "key-broker/audit.jsonl · כל-חתימת-כספת-כולל-DENY"}
          extra={<Chip>{fmtInt(live.data?.count || 0)} events</Chip>}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setSrc("shield")} className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold", src === "shield" ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200" : "border-zinc-800 text-zinc-500")}>מגן</button>
          <button onClick={() => setSrc("broker")} className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold", src === "broker" ? "border-violet-500/50 bg-violet-500/10 text-violet-200" : "border-zinc-800 text-zinc-500")}>ברוקר</button>
          <span className="mx-1 h-4 w-px bg-zinc-800" aria-hidden />
          {["", "ALLOW", "WARN", "BLOCK", "DENY"].map((v) => (
            <button key={v || "all"} onClick={() => setVerdict(v)} className={cn("rounded-full border px-2.5 py-1 font-mono text-[10px]", verdict === v ? "border-zinc-500 text-zinc-200" : "border-zinc-800 text-zinc-600 hover:text-zinc-400")} dir="ltr">
              {v || "ALL"}
            </button>
          ))}
        </div>
      </Panel>

      <div className="max-h-[520px] space-y-1.5 overflow-y-auto pr-1 nexus-scroll" dir="ltr">
        {evs.length === 0 && !live.loading && <Panel className="p-6 text-center text-xs text-zinc-600" corners={false}>ריק-בכנות — אין-אירועי-ביקורת-בטווח</Panel>}
        {evs.map((e, i) => {
          const at = String(e.at || "");
          const kind = String(e.kind || e.op || "");
          const detail = e.addr ? mask(String(e.addr), 12, 8) : e.door ? String(e.door) : e.len !== undefined ? `len=${String(e.len)} urls=${String(e.urls ?? 0)}` : e.reason ? String(e.reason) : "";
          return (
            <div key={at + i} className="flex items-center justify-between gap-2 rounded-md border border-zinc-800/70 bg-zinc-900/40 px-3 py-2 font-mono text-[11px]">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-zinc-600">{ago(at)} ago</span>
                <span className="truncate text-zinc-300">{kind}</span>
                {detail && <span className="hidden truncate text-zinc-500 sm:inline">{detail}</span>}
              </div>
              {vChip(e.verdict)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ShieldSec({ data, sub }: { data: NexusData; sub: string }) {
  if (sub === "scanner") return <Scanner />;
  if (sub === "audit") return <Audit />;
  return <Posture data={data} />;
}
