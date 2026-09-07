"use client";

// ─────────────────────────────────────────────────────────────────────────────
// VaultView — the sovereign key vault. ONE paste → the full key set.
//
// The operator pastes the account-creation master password (or any single
// WIF). The server derives all four role keys locally (sha256 chain
// derivation), compares each derived PUBLIC key against what Steem / Hive /
// Blurt publish in the account authorities, and stores only what matches.
// The secret never leaves the machine, is never logged, never returned.
//
// Sections: (1) master-connect flow with live 3-chain match matrix,
// (2) stored-keys state per chain, (3) advanced single-WIF paste,
// (4) what each key unlocks.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Lock,
  RefreshCw,
  ShieldCheck,
  Swords,
  Trash2,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import {
  connectDelegatedSoldier,
  deleteArmyAccount,
  deriveMaster,
  relTime,
  triggerLinkageFix,
  useLinkage,
  useVaultAccounts,
  useVaultMatrix,
  wipeVaultRole,
  type LinkageSoldier,
  type MasterDeriveResponse,
  type MasterRoleMatch,
} from "./api";

/* 87 — L9 אחדות-הצי: קישוריות כל חייל לראש — חיה מהשרשראות (posting.account_auths
 * ∋ headcorner ×steem+hive). מראה גם את שלמות-המפתחות (לא-למחוק!) וה-RC שמאט
 * את ההתכנסות ב-Hive. הכפתור מצית audit+fix מנותק — אפס-חסימה. */
function LinkagePanel() {
  const t = useToaster();
  const linkage = useLinkage();
  const [running, setRunning] = useState(false);

  const rep = linkage?.report ?? null;
  const soldiers: LinkageSoldier[] = rep?.soldiers ?? [];
  const keySummary = (s: LinkageSoldier) => {
    const merged = { ...(s.hive.keysIntact ?? {}), ...(s.steem.keysIntact ?? {}) };
    const keys = Object.keys(merged);
    if (!keys.length) return "מואצל";
    const ok = keys.filter((k) => merged[k]).length;
    return `${ok}/${keys.length} תפקידים`;
  };
  const keysAllOk = soldiers.every((s) => {
    const merged = { ...(s.hive.keysIntact ?? {}), ...(s.steem.keysIntact ?? {}) };
    const vals = Object.values(merged);
    return !vals.length || vals.every(Boolean);
  });

  async function runCheck() {
    setRunning(true);
    try {
      const res = await triggerLinkageFix();
      if (res.ok) t.ok("בדיקת-קישוריות הופעלה", "audit חי נשלח — התוצאה תתרענן בעוד רגע · תיקון-עצמי חתום הופעל ברקע");
      else t.err("הפעלה נכשלה", res.error ?? "שגיאה לא ידועה");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[13px] font-bold text-zinc-100">
            <Link2 className="size-4 text-emerald-400" aria-hidden="true" />
            אחדות-הצי · קישוריות לראש (L9 · 87)
          </h2>
          <Button
            size="sm"
            variant="outline"
            disabled={running}
            onClick={runCheck}
            className="h-7 gap-1.5 border-zinc-700 px-2.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
          >
            <RefreshCw className={cn("size-3", running && "animate-spin")} aria-hidden="true" />
            {running ? "בודק…" : "בדק עכשיו"}
          </Button>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
          כל חייל נושא את @{rep?.head ?? "headcorner"} בסמכות-הפוסטינג שלו — על Steem וגם על Hive
          (מוכח-מהשרשראות, לא הצהרה). התיקון-האוטומטי רק <span className="text-zinc-300">מוסיף</span> רשות-חשבון —
          אף מפתח לא נמחק ולא מסובב · נבדק {linkage?.ageSec != null && rep ? relTime(rep.at) : "—"}
        </p>
        {!linkage ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : !linkage.ok || !rep ? (
          <p className="text-[12px] text-red-400">{linkage.error ?? "אין דוח"}</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge
                className={cn(
                  "border-0",
                  rep.allLinked ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300",
                )}
              >
                {rep.linkedChains}/{rep.chainsTotal} שרשראות מקושרות
              </Badge>
              <Badge className="border-0 bg-zinc-800 text-zinc-300">{rep.soldiersTotal} חיילים</Badge>
              <Badge
                className={cn(
                  "border-0",
                  keysAllOk ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300",
                )}
              >
                {keysAllOk ? "מפתחות שלמים — אף סטייה" : "⚠️ סטיית-מפתחות בשרשרת"}
              </Badge>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-zinc-800 scrollbar-thin">
              <table className="w-full text-right text-[11px]">
                <thead className="sticky top-0 bg-zinc-900 text-zinc-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">חייל</th>
                    <th className="px-3 py-2 font-medium">Steem</th>
                    <th className="px-3 py-2 font-medium">Hive</th>
                    <th className="px-3 py-2 font-medium">מפתחות-בשרשרת</th>
                    <th className="px-3 py-2 font-medium">RC hive</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {soldiers.map((s) => (
                    <tr key={s.username} className="text-zinc-300">
                      <td className="px-3 py-1.5 font-mono text-[11px] text-zinc-200">@{s.username}</td>
                      <td className="px-3 py-1.5">
                        {s.steem?.linked ? (
                          <span className="text-emerald-400">מקושר</span>
                        ) : s.steem?.exists ? (
                          <span className="text-red-400">חסר</span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        {s.hive?.linked ? (
                          <span className="text-emerald-400">מקושר</span>
                        ) : s.hive?.exists ? (
                          <span className="text-amber-400" title="חסום-RC — הלולאה תנסה שוב">⏳ RC-gated</span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-zinc-400">{keySummary(s)}</td>
                      <td className="px-3 py-1.5 text-zinc-500">{s.rc?.hive != null ? `${s.rc.hive}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rep.allLinked && (
              <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
                התכנסות-אוטומטית: חיילים-ממתינים ב-Hive חסומי-RC (ה-op דורש ≈14% מנה — נמדד).
                הם <span className="text-amber-300">מוגנים-מריקון</span> — hiveFleetAnchor מדלג עליהם כדי שהמנה תצבור,
                ולולאת linkage (כל 90 דק׳) חותמת את החיבור ברגע שהדלק מספיק.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function useToaster() {
  const { toast } = useToast();
  return {
    ok: (title: string, detail?: string) => toast({ title, description: detail }),
    err: (title: string, detail?: string) =>
      toast({ title, description: detail, variant: "destructive" }),
  };
}

// ── role metadata (plain Hebrew — what it is and what it opens) ─────────────

const ROLE_META: Record<string, { he: string; unlocks: string; risk: "safe" | "power" | "full" }> = {
  posting: { he: "פרסום (Posting)", unlocks: "הצבעות, פוסטים, תביעת פרסים, עדכוני-פרוטוקול", risk: "safe" },
  active: { he: "פעיל (Active)", unlocks: "עסקאות והמרות, escrow, Hive-Engine, האצלות SP, לידת חשבונות", risk: "power" },
  memo: { he: "תזכיר (Memo)", unlocks: "הצפנה ופענוח של תזכירים בטרנספרים", risk: "safe" },
  owner: { he: "בעלים (Owner)", unlocks: "שליטה מלאה — שינוי כל שאר המפתחות. הכי חזק והכי רגיש", risk: "full" },
};

const ROLE_ORDER = ["posting", "active", "memo", "owner"];
const CHAIN_LABEL: Record<string, string> = { steem: "Steem", hive: "Hive", blurt: "Blurt" };
const GRID_COLS = "grid grid-cols-[1.3fr_1fr_2.5rem_2.5rem_2.5rem]";

function MatchDot({ v }: { v: boolean | null }) {
  const label = v === true ? "תואם — המפתח שולט כאן" : v === false ? "לא תואם" : "השרשרת לא ענתה";
  return (
    <span
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-4 items-center justify-center rounded-full text-[9px] font-bold",
        v === true
          ? "bg-emerald-400/15 text-emerald-300"
          : v === false
            ? "bg-zinc-700/60 text-zinc-500"
            : "bg-amber-400/10 text-amber-400/70",
      )}
    >
      {v === true ? "✓" : v === false ? "✗" : "?"}
    </span>
  );
}

// ── main view ────────────────────────────────────────────────────────────────

export function VaultView({ onNavigate }: { onNavigate?: (v: string) => void }) {
  const t = useToaster();
  const matrix = useVaultMatrix();
  const army = useVaultAccounts();

  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [target, setTarget] = useState("");
  const [deriving, setDeriving] = useState(false);
  const [derived, setDerived] = useState<MasterDeriveResponse | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [storing, setStoring] = useState(false);
  const [wiping, setWiping] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [advOpen, setAdvOpen] = useState(false);
  const [advWif, setAdvWif] = useState("");
  const [delName, setDelName] = useState("");
  const [connectingDelegated, setConnectingDelegated] = useState(false);

  // יעד-החיבור: שדה שם-החשבון. ריק = החשבון הראשי; שם אחר = חשבון-צבא חדש.
  const targetName =
    target.trim().replace(/^@/, "").toLowerCase() || matrix?.account || "headcorner";
  const isArmyTarget = targetName !== (matrix?.account ?? "headcorner");

  const chains = matrix?.chains ?? [];
  const stored = matrix?.stored ?? [];
  const controlled = chains.filter((c) => c.exists === true);
  const sameKeysEverywhere =
    controlled.length >= 2 &&
    controlled.every((c) => c.posting === controlled[0].posting && c.active === controlled[0].active);

  const roles: MasterRoleMatch[] = derived?.roles ?? [];
  const matchedCount = roles.filter((r) => r.steemControls).length;
  const pickedRoles = ROLE_ORDER.filter((r) => picked[r]);

  const armyList = (army.data?.army ?? []) as {
    username: string;
    mode?: string;
    roles: { role: string; pubMask: string }[];
    chains: Record<string, string[]>;
    addedAt: string;
  }[];
  const delegatedCount = armyList.filter((a) => a.mode === "operator-delegated").length;

  /** Task 86 — connect a rescue soldier: the SERVER proves the posting
   *  account-authority on both chains; zero secrets, no password needed. */
  async function connectDelegated() {
    const name = delName.trim().replace(/^@/, "").toLowerCase();
    if (!name) {
      t.err("חסר שם-חשבון");
      return;
    }
    setConnectingDelegated(true);
    try {
      const res = await connectDelegatedSoldier(name);
      if (res.ok) {
        t.ok(
          `@${res.username} חובר כחייל-מואצל`,
          `עוגן-פוסטינג אומת מהשרשרת: ${(res.verifiedOn ?? []).join("+")} · @${res.operator} בסמכות-הפוסטינג במשקל-סף · חותם דרך הפוסטינג של הראשי · אפס-סודות-חדשים${res.daemonRestarted ? " · הדמון אותחל — החייל בלופים" : ""}`, 
        );
        setDelName("");
        army.refetch();
      } else {
        t.err("חיבור-מואצל נכשל", res.error ?? "שגיאה לא ידועה");
      }
    } finally {
      setConnectingDelegated(false);
    }
  }

  const derive = async () => {
    const s = secret.trim();
    if (s.length < 20 || deriving) return;
    setDeriving(true);
    try {
      const res = await deriveMaster(targetName, s, []);
      if (res.ok && res.roles) {
        setDerived(res);
        const def: Record<string, boolean> = {};
        for (const r of res.roles) def[r.role] = r.steemControls && r.role !== "owner";
        setPicked(def);
        const matched = res.roles.filter((r) => r.steemControls);
        if (matched.length === 0) {
          t.err(
            "הסיסמה לא מזוהה",
            "אף מפתח שנגזר לא תאם את ההרשאות בשרשרת — לא נשמר כלום. ודאו שזו סיסמת האב המקורית של החשבון.",
          );
        } else {
          t.ok(
            `זוהו ${matched.length} מפתחות עבור @${targetName}`,
            `תואמים: ${matched.map((m) => ROLE_META[m.role]?.he ?? m.role).join(" · ")}`,
          );
        }
      } else {
        t.err("גזירה נכשלה", res.error ?? "שגיאה לא מוכרת");
      }
    } finally {
      setDeriving(false);
    }
  };

  const store = async (rolesToStore: string[], fromAdvanced = false) => {
    const payload = fromAdvanced ? advWif.trim() : secret.trim();
    if (payload.length < 20) {
      t.err("חסר הסוד", "הדביקו את סיסמת האב או ה-WIF ונסו שוב");
      return;
    }
    setStoring(true);
    try {
      const res = await deriveMaster(targetName, payload, rolesToStore);
      if (res.ok && res.stored && res.stored.length > 0) {
        t.ok(
          res.tier === "army"
            ? `@${targetName} חובר לצבא — ${res.stored.length} מפתחות בכספת`
            : `נשמרו ${res.stored.length} מפתחות בכספת`,
          `${res.stored
            .map((s) => `${ROLE_META[s.role]?.he ?? s.role} ${s.pubMask}`)
            .join(" · ")}${res.daemonRestarted ? " · הדמון הופעל מחדש עם המפתחות" : ""}${res.tier === "army" ? " · לולאות הצבא נטענות" : ""}`,
        );
        if (res.tier === "army") army.refetch();
        setDerived(null);
        setPicked({});
        setSecret("");
        setAdvWif("");
      } else {
        t.err("שמירה נכשלה", res.storedError ?? res.error ?? "אף תפקיד לא אומת מול השרשרת");
      }
    } finally {
      setStoring(false);
    }
  };

  const removeArmyAccount = async (username: string) => {
    // 86 — destructive guard: a one-click disconnect must never happen by accident
    if (!window.confirm(`לנתק את @${username} מהצבא? הלופים שלו יושבתו עד חיבור מחדש.`)) return;
    setRemoving(username);
    try {
      const res = await deleteArmyAccount(username);
      if (res.ok) {
        t.ok(`@${username} נותק מהצבא`, "הכניסה נמחקה מהכספת והדמון הופעל מחדש");
        army.refetch();
      } else {
        t.err("ניתוק נכשל", res.error);
      }
    } finally {
      setRemoving(null);
    }
  };

  const wipe = async (role: string) => {
    // 86 — destructive guard (live incident 17:47Z: an accidental wipe cost a
    // role key and needed a git-history seal recovery — confirm() is the wall)
    if (!window.confirm(`למחוק את מפתח ה-${ROLE_META[role]?.he ?? role} מהכספת? התפקיד יאבד עד הדבקה-מחדש של מפתח-האב.`)) return;
    setWiping(role);
    try {
      const res = await wipeVaultRole(role);
      if (res.ok) t.ok(`מפתח ${ROLE_META[role]?.he ?? role} נמחק מהכספת`);
      else t.err("מחיקה נכשלה", res.error);
    } finally {
      setWiping(null);
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      {/* header */}
      <section className="rounded-xl border border-zinc-800 bg-gradient-to-l from-zinc-900/80 to-zinc-900/40 px-4 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-400/10">
            <Lock className="size-4 text-emerald-300" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[15px] font-black text-zinc-100">כספת המפתחות — חיבור אחד, שליטה מלאה</h1>
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
              מדביקים <span className="text-zinc-300">סיסמת-אב אחת</span> — המערכת גוזרת לבד את כל המפתחות
              (פרסום · פעיל · תזכיר · בעלים), מאמתת כל אחד מול שלוש שרשראות ומגדירה הכל.
            </p>
          </div>
          {matrix?.lastSyncAt && (
            <Badge variant="outline" className="border-emerald-400/30 bg-emerald-400/5 text-[10px] text-emerald-300">
              סונכרן {relTime(matrix.lastSyncAt)}
            </Badge>
          )}
        </div>
        {sameKeysEverywhere && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-[11px] leading-relaxed text-emerald-200/90">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              עובדה מהשרשראות: <span className="font-semibold">אותם מפתחות שולטים בכל השרשראות החיות</span> —
              {controlled.map((c) => ` ${CHAIN_LABEL[c.id] ?? c.id}`).join(" · ")}. סיסמת-אב אחת = שליטה מרובה.
            </span>
          </div>
        )}
      </section>

      {/* master connect */}
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2">
            <KeyRound className="size-4 text-emerald-300" aria-hidden="true" />
            <h2 className="text-[13px] font-bold text-zinc-100">חיבור מפתח-ראשי</h2>
            <span className="text-[10px] text-zinc-500">שלב אחד · הכל מוגדר אוטומטית</span>
            {isArmyTarget && (
              <Badge variant="outline" className="border-amber-400/30 bg-amber-400/5 px-1.5 py-0 text-[9px] text-amber-300">
                מצב צבא — חשבון נוסף
              </Badge>
            )}
          </div>

          <Label htmlFor="vault-username" className="text-[12px] text-zinc-300">
            שם החשבון — השאירו ריק לחשבון הראשי, או הקלידו שם אחר כדי לחבר אותו לצבא
          </Label>
          <Input
            id="vault-username"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={`ראשי: @${matrix?.account ?? "headcorner"} · צבא: @your-other-account`}
            dir="ltr"
            className="h-9 border-zinc-800 bg-zinc-950 font-mono text-[12px]"
            autoComplete="off"
            spellCheck={false}
          />

          <Label htmlFor="master-secret" className="mt-3 text-[12px] text-zinc-300">
            סיסמת האב של @{targetName}, או כל מפתח WIF יחיד
          </Label>
          <div className="mt-1.5 flex gap-2" dir="ltr">
            <div className="relative flex-1">
              <Input
                id="master-secret"
                type={showSecret ? "text" : "password"}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && secret.trim().length >= 20 && !deriving) void derive();
                }}
                placeholder="master password / 5K… WIF"
                className="h-10 border-zinc-800 bg-zinc-950 pe-9 font-mono text-[12px]"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => setShowSecret((s) => !s)}
                aria-label={showSecret ? "הסתר" : "הצג"}
                className="absolute end-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <Button
              className="h-10 shrink-0 bg-emerald-500 px-4 text-[12px] font-bold text-zinc-950 hover:bg-emerald-400"
              disabled={deriving || secret.trim().length < 20}
              onClick={() => void derive()}
            >
              {deriving ? (
                <>
                  <RefreshCw className="me-1.5 size-3.5 animate-spin" aria-hidden="true" />
                  גוזר ומאמת…
                </>
              ) : (
                "גזור ואמת מול 3 שרשראות"
              )}
            </Button>
          </div>
          <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-500">
            <Lock className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            הסוד נשאר בזיכרון המכונה הזאת בלבד: לא נשמר, לא נכתב ביומן, לא נשלח לשרת חוץ. מה שנשמר בסוף זה רק
            המפתחות שאומתו מול השרשרת — חשבון ראשי ב-agent/.env וכל חשבון-צבא ב-agent/keys/vault.json (מחוץ ל-git).
          </p>

          {/* derive results */}
          {deriving && (
            <div className="mt-4 space-y-2" aria-live="polite">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-11 w-full bg-zinc-800/60" />
              ))}
            </div>
          )}

          {roles.length > 0 && !deriving && (
            <div className="mt-4 overflow-hidden rounded-lg border border-zinc-800">
              <div
                className={cn(GRID_COLS, "items-center gap-x-2 bg-zinc-950/80 px-3 py-2 text-[10px] text-zinc-500")}
                dir="rtl"
              >
                <span>תפקיד</span>
                <span>טביעת מפתח ציבורי</span>
                <span className="w-10 text-center">Steem</span>
                <span className="w-10 text-center">Hive</span>
                <span className="w-10 text-center">Blurt</span>
              </div>
              {roles
                .slice()
                .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
                .map((r) => (
                  <div
                    key={r.role}
                    className={cn(
                      GRID_COLS,
                      "items-center gap-x-2 border-t border-zinc-800/60 px-3 py-2.5 text-[11px]",
                      r.steemControls ? "bg-emerald-400/[0.03]" : "bg-zinc-900/40",
                    )}
                    dir="rtl"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("font-semibold", r.steemControls ? "text-zinc-100" : "text-zinc-400")}>
                          {ROLE_META[r.role]?.he ?? r.role}
                        </span>
                        {picked[r.role] && r.steemControls && (
                          <Check className="size-3 text-emerald-400" aria-hidden="true" />
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-zinc-500">{ROLE_META[r.role]?.unlocks}</div>
                    </div>
                    <span className="truncate font-mono text-[10px] text-zinc-400" dir="ltr">
                      {r.derivedMask}
                    </span>
                    <span className="w-10 text-center">
                      <MatchDot v={r.match.steem} />
                    </span>
                    <span className="w-10 text-center">
                      <MatchDot v={r.match.hive} />
                    </span>
                    <span className="w-10 text-center">
                      <MatchDot v={r.match.blurt} />
                    </span>
                  </div>
                ))}
            </div>
          )}

          {roles.length > 0 && !deriving && (
            <div className="mt-3 space-y-3">
              {matchedCount === 0 ? (
                <div className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2.5 text-[11px] leading-relaxed text-red-200/90">
                  <span className="font-semibold">אף מפתח לא תאם את ההרשאות על השרשרת.</span> זו ההגנה עובדת —
                  כלום לא נשמר. אם המפתחות של הסיסמה הזאת הוחלפו בעבר, הדביקו את ה-WIF הנוכחי בהדבקה המתקדמת למטה.
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2.5">
                    {ROLE_ORDER.map((role) => {
                      const m = roles.find((r) => r.role === role);
                      if (!m?.steemControls) return null;
                      return (
                        <label
                          key={role}
                          className="flex cursor-pointer items-center gap-2 text-[11px] text-zinc-300"
                        >
                          <Switch
                            checked={Boolean(picked[role])}
                            onCheckedChange={(v) => setPicked((p) => ({ ...p, [role]: v }))}
                            aria-label={`שמור ${ROLE_META[role]?.he}`}
                          />
                          {ROLE_META[role]?.he}
                          {role === "owner" && picked[role] && (
                            <span className="text-[9px] text-amber-300">סיכון גבוה — לא נדרש לתפעול</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                  <Button
                    className="w-full bg-emerald-500 text-[12px] font-bold text-zinc-950 hover:bg-emerald-400"
                    disabled={storing || pickedRoles.length === 0}
                    onClick={() => void store(pickedRoles)}
                  >
                    {storing ? (
                      <>
                        <RefreshCw className="me-1.5 size-3.5 animate-spin" aria-hidden="true" />
                        מאמת מול השרשרת ושומר…
                      </>
                    ) : (
                      `שמור ${pickedRoles.length > 0 ? `${pickedRoles.length} מפתחות` : "מפתחות"} והפעל את המערכת`
                    )}
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* stored state per chain */}
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[13px] font-bold text-zinc-100">מצב הכספת — מה נשלט ומאיפה</h2>
            <span className="text-[10px] text-zinc-500">
              חשבון{" "}
              <span className="font-mono text-zinc-400" dir="ltr">
                @{matrix?.account ?? "—"}
              </span>
            </span>
          </div>

          {!matrix ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full bg-zinc-800/60" />
              <Skeleton className="h-8 w-3/4 bg-zinc-800/60" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {chains.map((c) => (
                  <div key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-bold text-zinc-200">{CHAIN_LABEL[c.id] ?? c.id}</span>
                      <MatchDot v={c.exists} />
                    </div>
                    {c.exists ? (
                      <dl className="mt-2 space-y-1 text-[10px]" dir="ltr">
                        {(["posting", "active", "owner"] as const).map((k) => (
                          <div key={k} className="flex items-center justify-between gap-2">
                            <dt className="text-zinc-500">{k}</dt>
                            <dd className="font-mono text-zinc-400">{c[k]}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="mt-1.5 text-[10px] text-zinc-500">
                        {c.exists === false ? "אין חשבון בשרשרת הזאת" : "ה-RPC לא ענה — ייבדק שוב ברענון"}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <div className="overflow-hidden rounded-lg border border-zinc-800">
                {stored.length === 0 ? (
                  <div className="bg-zinc-950/60 px-3 py-4 text-center text-[11px] text-zinc-500">
                    הכספת ריקה — הדמון במצב ניטור-בלבד. חברו מפתח-ראשי למעלה והכל יתעורר.
                  </div>
                ) : (
                  stored
                    .slice()
                    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
                    .map((s) => (
                      <div
                        key={s.role}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-zinc-800/60 px-3 py-2.5 last:border-b-0"
                      >
                        <div className="min-w-[150px]">
                          <div className="text-[12px] font-semibold text-zinc-200">
                            {ROLE_META[s.role]?.he ?? s.role}
                          </div>
                          <span className="font-mono text-[10px] text-zinc-500" dir="ltr">
                            {s.pubMask}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                          <span>שליטה:</span>
                          <span className="flex items-center gap-1">
                            Steem <MatchDot v={s.controls.steem} />
                          </span>
                          <span className="flex items-center gap-1">
                            Hive <MatchDot v={s.controls.hive} />
                          </span>
                          <span className="flex items-center gap-1">
                            Blurt <MatchDot v={s.controls.blurt} />
                          </span>
                        </div>
                        <div className="ms-auto flex items-center gap-2">
                          {(s.role === "posting" || s.role === "active") && !matrix.dryRun && (
                            <Badge
                              variant="outline"
                              className="border-emerald-400/30 text-[9px] text-emerald-300"
                            >
                              חותם
                            </Badge>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 border-zinc-700 px-2 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-red-300"
                            disabled={wiping != null}
                            onClick={() => void wipe(s.role)}
                          >
                            <Trash2 className="size-3" aria-hidden="true" />
                            {wiping === s.role ? "…" : "מחק"}
                          </Button>
                        </div>
                      </div>
                    ))
                )}
              </div>

              {matrix.dryRun && stored.some((s) => s.role === "posting" || s.role === "active") && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2.5">
                  <span className="text-[11px] text-amber-200/90">
                    המפתחות בכספת — אבל המערכת עדיין במצב יבש (לא חותמת על השרשרת).
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 border-amber-400/30 text-[10px] text-amber-200 hover:bg-amber-400/10"
                    onClick={() => onNavigate?.("command")}
                  >
                    הפעלת מצב אמיתי בפיקוד
                    <ArrowLeft className="size-3" aria-hidden="true" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* army roster — multi-account economic engine */}
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Swords className="size-4 text-emerald-300" aria-hidden="true" />
            <h2 className="text-[13px] font-bold text-zinc-100">צבא החשבונות — מנוע כלכלי רב-חשבוני</h2>
            {army.data?.counts ? (
              <Badge
                variant="outline"
                className="border-emerald-400/30 bg-emerald-400/5 px-1.5 py-0 font-mono text-[10px] text-emerald-300"
              >
                {army.data.counts.total} חשבונות
              </Badge>
            ) : null}
            <span className="text-[10px] text-zinc-500">ראשי 1 · מחוברים {army.data?.counts.operator ?? 0} (מואצלים {delegatedCount}) · נולדו במפעל {army.data?.counts.factory ?? 0}</span>
          </div>
          <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
            כל חשבון שחובר כאן מקבל <span className="text-zinc-300">לופים משלו</span>: תביעת פרסים, הצבעת אצירה
            (פס-אישי — אף שני חשבונות שלנו לא מצביעים על אותו פוסט) וריכוז-ערך — יתרה נזילה מעל סף עוברת
            אוטומטית לחשבון הראשי. חשבון מחובר = כוח פרודוקטיבי נוסף, ללא פעולה נוספת מצדך.
          </p>

          {/* Task 86 — delegated rescue soldier: no password, chain-proven anchor */}
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2">
            <KeyRound className="size-3.5 text-amber-300" aria-hidden="true" />
            <span className="text-[11px] font-semibold text-amber-200/90">חייל-מואצל (עוגן-פוסטינג):</span>
            <Input
              dir="ltr"
              value={delName}
              onChange={(e) => setDelName(e.target.value)}
              placeholder="ynet"
              aria-label="שם חשבון לחיבור-מואצל"
              className="h-8 w-36 border-zinc-700 bg-zinc-950/80 text-[12px]"
            />
            <Button
              size="sm"
              className="h-8 border border-amber-400/30 bg-amber-400/10 px-2.5 text-[11px] text-amber-200 hover:bg-amber-400/20"
              disabled={connectingDelegated || delName.trim().length === 0}
              onClick={() => void connectDelegated()}
            >
              {connectingDelegated ? "מאמת מהשרשרת…" : "חבר"}
            </Button>
            <span className="text-[10px] leading-snug text-zinc-500">
              בלי סיסמה — השרת מוכיח מהשרשראות שהראשי יושב בסמכות-הפוסטינג של החשבון (Steem+Hive, משקל-סף) ואז מחבר;
              החייל חותם דרך הפוסטינג של הראשי — אפס-סודות-חדשים
            </span>
          </div>

          {!army.data ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full bg-zinc-800/60" />
              <Skeleton className="h-9 w-2/3 bg-zinc-800/60" />
            </div>
          ) : army.data.counts.operator === 0 && army.data.counts.factory === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-4 text-center text-[11px] text-zinc-500">
              הצבא ריק — הקלידו שם-חשבון + סיסמת-אב בכרטיס למעלה והוא יצטרף בעצמו (גזירה, אימות והגדרה אוטומטיים).
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-zinc-800">
              {armyList.map((a) => (
                <div
                  key={a.username}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-zinc-800/60 px-3 py-2.5 last:border-b-0"
                >
                  <div className="min-w-[140px]">
                    <div className="flex items-center gap-1.5">
                      <Users className="size-3 text-zinc-500" aria-hidden="true" />
                      <span className="font-mono text-[12px] font-semibold text-zinc-200" dir="ltr">
                        @{a.username}
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-500">חובר {a.addedAt ? relTime(a.addedAt) : "—"}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {a.mode === "operator-delegated" ? (
                      <Badge
                        variant="outline"
                        className="border-amber-400/30 bg-amber-400/10 px-1.5 py-0 text-[9px] text-amber-300"
                        title="חייל-מואצל: אין לנו את המפתחות שלו — הוא חותם דרך הפוסטינג של הראשי (עוגן-חילוץ חי, מאומת מהשרשרת)"
                      >
                        עוגן-פוסטינג · מואצל
                      </Badge>
                    ) : (
                      a.roles.map((r) => (
                        <Badge
                          key={r.role}
                          variant="outline"
                          className="border-zinc-700 px-1.5 py-0 font-mono text-[9px] text-zinc-400"
                          title={r.pubMask}
                        >
                          {r.role}
                        </Badge>
                      ))
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                    {Object.entries(a.chains ?? {}).map(([c, rs]) => (
                      <Badge
                        key={c}
                        variant="outline"
                        className="border-emerald-400/20 bg-emerald-400/5 px-1.5 py-0 text-[9px] text-emerald-300/80"
                      >
                        {CHAIN_LABEL[c] ?? c}:{rs.length}
                      </Badge>
                    ))}
                  </div>
                  <div className="ms-auto">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 border-zinc-700 px-2 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-red-300"
                      disabled={removing != null}
                      onClick={() => void removeArmyAccount(a.username)}
                    >
                      <Trash2 className="size-3" aria-hidden="true" />
                      {removing === a.username ? "…" : "נתק"}
                    </Button>
                  </div>
                </div>
              ))}
              {(army.data.factoryAgents as { username: string }[]).map((f) => (
                <div
                  key={f.username}
                  className="flex flex-wrap items-center gap-x-3 border-b border-zinc-800/60 px-3 py-2.5 last:border-b-0"
                >
                  <div className="flex items-center gap-1.5">
                    <Users className="size-3 text-emerald-400/70" aria-hidden="true" />
                    <span className="font-mono text-[12px] font-semibold text-zinc-200" dir="ltr">
                      @{f.username}
                    </span>
                  </div>
                  <Badge variant="outline" className="border-emerald-400/20 px-1.5 py-0 text-[9px] text-emerald-300/80">
                    נולד במפעל
                  </Badge>
                  <span className="ms-auto text-[10px] text-zinc-500">המפתחות שלו חיים במכונה — הלופים שלו חמושים</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* advanced single-WIF paste */}
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="p-4 sm:p-5">
          <button
            type="button"
            onClick={() => setAdvOpen((o) => !o)}
            className="flex w-full items-center gap-2 text-start"
            aria-expanded={advOpen}
          >
            <ChevronDown
              className={cn("size-4 text-zinc-500 transition-transform", advOpen && "rotate-180")}
              aria-hidden="true"
            />
            <span className="text-[13px] font-bold text-zinc-200">הדבקה מתקדמת — מפתח WIF יחיד</span>
            <span className="text-[10px] text-zinc-500">המערכת מזהה לבד לאיזה תפקיד הוא שייך</span>
          </button>
          {advOpen && (
            <div className="mt-3 space-y-2">
              <div className="flex gap-2" dir="ltr">
                <Input
                  type="password"
                  value={advWif}
                  onChange={(e) => setAdvWif(e.target.value)}
                  placeholder="5K… WIF"
                  className="h-9 border-zinc-800 bg-zinc-950 font-mono text-[12px]"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  className="h-9 shrink-0 bg-emerald-500 text-[11px] font-bold text-zinc-950 hover:bg-emerald-400"
                  disabled={storing || advWif.trim().length < 45}
                  onClick={() => void store(["posting", "active", "memo", "owner"], true)}
                >
                  {storing ? "מזהה…" : "זהה ושמור"}
                </Button>
              </div>
              <p className="text-[10px] leading-relaxed text-zinc-500">
                מדביקים מפתח אחד — המערכת גוזרת את המפתח הציבורי, משווה מול כל ההרשאות בכל השרשראות, ושומרת
                אותו לכל תפקיד שהוא באמת שולט בו. לא תואם לכלום → לא נשמר כלום.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 87 — L9 fleet-linkage: every soldier ↔ head, live from the chains */}
      <LinkagePanel />

      {/* capabilities legend */}
      <Card className="border-zinc-800 bg-zinc-900/40">
        <CardContent className="p-4 sm:p-5">
          <h2 className="mb-3 text-[13px] font-bold text-zinc-100">מה כל מפתח פותח</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {ROLE_ORDER.map((role) => (
              <div key={role} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-zinc-200">{ROLE_META[role].he}</span>
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      ROLE_META[role].risk === "safe"
                        ? "bg-emerald-400"
                        : ROLE_META[role].risk === "power"
                          ? "bg-amber-400"
                          : "bg-red-400",
                    )}
                    aria-hidden="true"
                  />
                </div>
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">{ROLE_META[role].unlocks}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
