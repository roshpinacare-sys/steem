"use client";

// ─────────────────────────────────────────────────────────────────────
// RAILS-STRIP (r188) — פס-המסילות הריבוניות: BLURT + TRON חי בלוח-הכסף.
//
// רקע: ביקורת r188-b מצאה ש-/api/money/blurt (המסילה-המוכחת) יתום —
// אפס-קוראים-מאז-נבנה; ומסילת-TRON הוכחה (r187-A) ונמדדת (r188) אך
// לא-נראית-למפעיל. הפס-הזה מחבר: שתי-המסילות חיות בלוח-המוביל.
// אפס-סודות — רק פסקי-דין, מספרים-מדודים וכתובות-פומביות.
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { Cable, RefreshCw, ShieldCheck } from "lucide-react";

interface BlurtLeg {
  ok?: boolean;
  at?: string;
  rpc?: { url?: string; alive?: boolean; ms?: number };
  balances?: { liquid?: number; vesting?: number };
  keyPreflight?: { vaultOpened?: boolean; liveActive?: boolean; match?: boolean };
  verdict?: "RAIL-ARMED" | "RAIL-NO-KEY" | "RPC-DOWN" | "NO-ACCOUNT";
}

interface TronCustody {
  proof?: { provedAt?: string | null; verdict?: string | null; address?: string | null } | null;
  balance?: { at?: string | null; verdict?: string | null; trx?: number | null; usdtTrc20?: number | null } | null;
  supervision?: { verdict?: string | null; detail?: string | null; at?: string | null };
}

const BLURT_VERDICT: Record<string, { label: string; cls: string }> = {
  "RAIL-ARMED": { label: "חי וחמוש", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  "RAIL-NO-KEY": { label: "בלי-מפתח-חי", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  "RPC-DOWN": { label: "RPC יורד", cls: "bg-red-500/10 text-red-700 dark:text-red-400" },
  "NO-ACCOUNT": { label: "אין-חשבון", cls: "bg-red-500/10 text-red-700 dark:text-red-400" },
};

const SUPER_VERDICT: Record<string, { label: string; cls: string }> = {
  pass: { label: "פיקוח תקין", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  warn: { label: "לא-נמדד", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  fail: { label: "אנומליה", cls: "bg-red-500/10 text-red-700 dark:text-red-400" },
};

function ago(iso?: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const m = Math.max(0, Math.round(ms / 60_000));
  return m < 60 ? `${m} דק'` : `${Math.round(m / 60)} ש'`;
}

export function RailsStrip() {
  const [blurt, setBlurt] = useState<BlurtLeg | null>(null);
  const [tron, setTron] = useState<TronCustody | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const b = await fetch("/api/money/blurt", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      setBlurt(b as BlurtLeg | null);
      const t = await fetch("/api/custody/tron", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      setTron(t as TronCustody | null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const bv = BLURT_VERDICT[blurt?.verdict ?? ""] ?? { label: "לא-נמדד", cls: "bg-muted text-muted-foreground" };
  const sv = SUPER_VERDICT[tron?.supervision?.verdict ?? ""] ?? { label: "ממתין-לביקורת", cls: "bg-muted text-muted-foreground" };
  const shortAddr = tron?.proof?.address ? `${tron.proof.address.slice(0, 8)}…${tron.proof.address.slice(-6)}` : "—";

  return (
    <section aria-label="מסילות ריבוניות — BLURT ו-TRON" className="grid gap-3 sm:grid-cols-2">
      {/* מסילת BLURT */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Cable className="size-4 text-muted-foreground" aria-hidden />
            מסילת BLURT
          </p>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${bv.cls}`}>{bv.label}</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-[11px] text-muted-foreground">נזיל (BLURT)</p>
            <p className="font-mono text-sm font-semibold tabular-nums">{blurt?.balances?.liquid != null ? blurt.balances.liquid.toFixed(3) : "—"}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">הצבעה (BP)</p>
            <p className="font-mono text-sm font-semibold tabular-nums">{blurt?.balances?.vesting != null ? blurt.balances.vesting.toFixed(3) : "—"}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">מדידה</p>
            <p className="text-sm font-semibold">{ago(blurt?.at)}</p>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          מדידה-וסמכות-מהכספת בלבד — אפס-שידור (R101d) · rpc {blurt?.rpc?.url ?? "—"} ({blurt?.rpc?.alive ? `${blurt.rpc.ms ?? "?"}ms` : "לא-עונה"})
        </p>
      </div>

      {/* מסילת TRON */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
            מסילת TRON — משמרת
          </p>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${sv.cls}`}>{sv.label}</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-[11px] text-muted-foreground">TRX</p>
            <p className="font-mono text-sm font-semibold tabular-nums">{tron?.balance?.trx != null ? tron.balance.trx.toFixed(6) : "—"}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">USDT (TRC-20)</p>
            <p className="font-mono text-sm font-semibold tabular-nums">{tron?.balance?.usdtTrc20 != null ? tron.balance.usdtTrc20.toFixed(2) : "—"}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">בעלות</p>
            <p className="text-sm font-semibold">{tron?.proof?.verdict === "PROVED" ? "PROVED" : "—"}</p>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {shortAddr} · כלי-יתרות לפני {ago(tron?.balance?.at)} · פיקוח לפני {ago(tron?.supervision?.at)}
        </p>
      </div>

      <button
        type="button"
        onClick={() => void load()}
        disabled={busy}
        className="col-span-full mx-auto flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        <RefreshCw className={`size-3 ${busy ? "animate-spin" : ""}`} aria-hidden />
        רענון מסילות
      </button>
    </section>
  );
}
