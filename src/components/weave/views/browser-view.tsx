"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · דפדפן הסוכנים — הגלישה החיה של האתר, מחוברת ל-z.ai.
//
// "דפדפן לסוכנים שיהיה לשימוש ברשת — שאתחבר ל-z.ai ועוד דרך האתר
// שלי עצמו, וגם אעבוד עליו משם, בקישורית מיוחדת חכמה."
//
// מה יש כאן, באמת:
//   • כרטיסיות גלישה — כל כרטיסיה היא עמוד שנקרא או חיפוש שבוצע.
//   • שורת כתובת חכמה — כתובת → קריאת עמוד; טקסט → חיפוש רשת.
//   • קריאת העמודים והחיפוש והצ'אט — הכל דרך ה-API של האתר ←
//     z-ai-web-dev-sdk בשרת. הקליינט לא רואה אף מפתח.
//   • הסוכן החי — צ'אט LLM שמכיר את העמוד הפתוח (הקשר מוזרם).
//   • קישורית חכמה — הסשן כולו (כרטיסיות + שיחה) נשמר בשרת וחוזר
//     כקישור ‎/#/browser?s=<slug>‎ שפותח את אותו מצב בדיוק — על כל
//     דומיין שהאתר חי עליו, כולל פריסה ריבונית עתידית.
//   • אמת נמדדת — כל פעולה מציגה את זמן התגובה שלה; סרגל הערוצים
//     מציג מונים אמיתיים ובדיקת-חיבור חיה (לא מילה — מדידה).
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bookmark,
  Compass,
  ExternalLink,
  FileText,
  Globe,
  Link2,
  Loader2,
  MessageSquare,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Timer,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CopyButton, FadeIn } from "../shared";

// ── טיפוסים ─────────────────────────────────────────────────────────

interface ReadData {
  title: string;
  finalUrl: string;
  publishedTime: string | null;
  text: string;
  links: Array<{ url: string; label: string }>;
  tokens: number | null;
  tookMs: number;
}

interface SearchItem {
  url: string;
  name: string;
  snippet: string;
  host_name: string;
  date: string;
  rank: number;
}

type CardKind = "home" | "read" | "search";

interface BrowserTab {
  id: string;
  kind: CardKind;
  url: string; // read: הכתובת · search: השאילתה · home: ""
  title: string;
  loading: boolean;
  error: string | null;
  read?: ReadData;
  results?: SearchItem[];
  tookMs?: number;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

interface SavedSession {
  slug: string;
  title: string;
  visits: number;
  createdAt: string;
  updatedAt: string;
}

interface ChannelStats {
  count: number;
  avgMs: number;
  lastAt: string | null;
  lastOk: boolean | null;
}

interface SessionState {
  cards: Array<{ id: string; kind: CardKind; url: string; title: string }>;
  activeCard: string;
  chat: ChatMsg[];
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `c${Date.now().toString(36)}${seq}`;
}

function looksLikeUrl(s: string): boolean {
  const t = s.trim();
  if (!t || /\s/.test(t)) return false;
  if (/^https?:\/\//i.test(t)) return true;
  return /^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(t);
}

const QUICK_LINKS: Array<{ label: string; url: string }> = [
  { label: "z.ai", url: "https://z.ai" },
  { label: "chat.z.ai", url: "https://chat.z.ai" },
  { label: "example.com", url: "https://example.com" },
];

// ── רכיב-עלה: כרטיסייה אחת ──────────────────────────────────────────

function TabBody({ tab }: { tab: BrowserTab }) {
  if (tab.loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-zinc-500">
        <Loader2 className="size-7 animate-spin text-emerald-500" aria-hidden />
        <p className="text-sm">
          {tab.kind === "read" ? "קורא את העמוד דרך שירות z.ai…" : "מחפש ברשת…"}
        </p>
      </div>
    );
  }
  if (tab.error) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <p className="mb-2 text-sm font-semibold text-red-400">הפעולה נכשלה</p>
        <p className="text-sm leading-relaxed text-zinc-500" dir="auto">
          {tab.error}
        </p>
      </div>
    );
  }
  if (tab.kind === "read" && tab.read) {
    const d = tab.read;
    return (
      <article className="mx-auto max-w-3xl">
        <header className="mb-4 border-b pb-4">
          <h2 className="text-lg font-bold leading-snug text-zinc-100" dir="auto">
            {d.title}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
            <span className="font-mono" dir="ltr">{d.finalUrl}</span>
            {d.publishedTime && (
              <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                {new Date(d.publishedTime).toLocaleDateString("he-IL")}
              </Badge>
            )}
            {d.tokens != null && (
              <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                {d.tokens.toLocaleString("he-IL")} טוקנים
              </Badge>
            )}
            <Badge
              variant="outline"
              className="border-emerald-700/60 text-emerald-400"
            >
              <Timer className="size-3" aria-hidden />
              {d.tookMs} מ״ש
            </Badge>
          </div>
        </header>
        <div
          className="max-h-[62vh] overflow-y-auto whitespace-pre-wrap text-base leading-7 text-zinc-300 [scrollbar-width:thin]"
          dir="auto"
        >
          {d.text}
        </div>
        {d.links.length > 0 && (
          <details className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
            <summary className="cursor-pointer text-sm font-semibold text-zinc-300">
              קישורים שנמצאו בעמוד ({d.links.length})
            </summary>
            <ul className="mt-2 grid max-h-64 gap-1 overflow-y-auto [scrollbar-width:thin]">
              {d.links.map((l) => (
                <li key={l.url}>
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-zinc-200"
                    dir="auto"
                  >
                    <ExternalLink className="size-3 shrink-0" aria-hidden />
                    <span className="truncate">{l.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </article>
    );
  }
  if (tab.kind === "search" && tab.results) {
    return (
      <div className="mx-auto max-w-3xl">
        <p className="mb-4 flex items-center gap-2 text-sm text-zinc-500">
          <Search className="size-4" aria-hidden />
          תוצאות עבור{" "}
          <span className="font-semibold text-zinc-300" dir="auto">
            {tab.url}
          </span>
          {tab.tookMs != null && (
            <Badge
              variant="outline"
              className="border-emerald-700/60 text-emerald-400"
            >
              <Timer className="size-3" aria-hidden />
              {tab.tookMs} מ״ש
            </Badge>
          )}
        </p>
        <ol className="grid gap-3">
          {tab.results.map((r) => (
            <li key={r.url}>
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-xl border border-zinc-800 bg-zinc-900/40 p-3.5 transition-colors hover:border-zinc-700 hover:bg-zinc-900/70"
              >
                <p className="text-sm font-semibold text-emerald-400" dir="auto">
                  {r.name}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-zinc-500" dir="ltr">
                  {r.host_name}
                  {r.date ? ` · ${r.date}` : ""}
                </p>
                <p className="mt-1.5 text-[13px] leading-6 text-zinc-400" dir="auto">
                  {r.snippet}
                </p>
              </a>
            </li>
          ))}
          {tab.results.length === 0 && (
            <li className="py-10 text-center text-sm text-zinc-500">
              אין תוצאות — נסה ניסוח אחר.
            </li>
          )}
        </ol>
      </div>
    );
  }
  return null;
}

// ── התצוגה הראשית ───────────────────────────────────────────────────

export function BrowserView({ sessionSlug }: { sessionSlug?: string }) {
  const [tabs, setTabs] = useState<BrowserTab[]>([
    { id: "home", kind: "home", url: "", title: "דף הבית", loading: false, error: null },
  ]);
  const [activeId, setActiveId] = useState("home");
  const [address, setAddress] = useState("");
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [session, setSession] = useState<{ slug: string; title: string; visits: number } | null>(null);
  const [saved, setSaved] = useState<SavedSession[]>([]);
  const [channels, setChannels] = useState<Record<string, ChannelStats> | null>(null);
  const [testing, setTesting] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<string | null>(null);

  const active = useMemo(
    () => tabs.find((t) => t.id === activeId) ?? tabs[0],
    [tabs, activeId],
  );

  // ── סרגל הערוצים: מונים נמדדים ────────────────────────────────────
  const refreshChannels = useCallback(() => {
    void fetch("/api/agent-browser/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) setChannels(j.channels);
      })
      .catch(() => {});
  }, []);

  const runConnectionTest = useCallback(async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/agent-browser/status", { method: "POST" });
      const j = await res.json();
      if (j?.ok) {
        toast.success("החיבור ל-z.ai חי — נמדד כרגע", {
          description: `הלוך-ושוב ${j.roundTripMs} מ״ש · התשובה שהתקבלה: "${String(j.sample).slice(0, 40)}"`,
        });
      } else {
        toast.error("בדיקת החיבור נכשלה", {
          description: String(j?.error ?? "שגיאה לא ידועה"),
        });
      }
      refreshChannels();
    } catch (e) {
      toast.error("בדיקת החיבור נכשלה", {
        description: e instanceof Error ? e.message : "שגיאת רשת",
      });
    } finally {
      setTesting(false);
    }
  }, [refreshChannels]);

  // ── ניווט: פתיחת כתובת (קריאה) או חיפוש ──────────────────────────
  const openUrl = useCallback(
    async (rawUrl: string, targetId?: string) => {
      const url = /^https?:\/\//i.test(rawUrl.trim())
        ? rawUrl.trim()
        : `https://${rawUrl.trim()}`;
      const id = targetId ?? nextId();
      if (targetId) {
        // רענון כרטיסייה קיימת (למשל בשחזור קישורית) — במקום כרטיסייה חדשה
        setTabs((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, url, loading: true, error: null } : t,
          ),
        );
      } else {
        const tab: BrowserTab = {
          id,
          kind: "read",
          url,
          title: rawUrl.trim(),
          loading: true,
          error: null,
        };
        setTabs((prev) => [...prev.slice(-7), tab]);
      }
      setActiveId(id);
      setAddress("");
      try {
        const res = await fetch("/api/agent-browser/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, s: sessionRef.current }),
        });
        const j = await res.json();
        setTabs((prev) =>
          prev.map((t) =>
            t.id === id
              ? j?.ok
                ? {
                    ...t,
                    loading: false,
                    title: (j.title as string).slice(0, 60),
                    read: {
                      title: j.title,
                      finalUrl: j.finalUrl,
                      publishedTime: j.publishedTime,
                      text: j.text,
                      links: j.links,
                      tokens: j.tokens,
                      tookMs: j.tookMs,
                    },
                  }
                : { ...t, loading: false, error: String(j?.error ?? "שגיאה") }
              : t,
          ),
        );
        refreshChannels();
      } catch (e) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  loading: false,
                  error: e instanceof Error ? e.message : "שגיאת רשת",
                }
              : t,
          ),
        );
      }
    },
    [refreshChannels],
  );

  const openSearch = useCallback(
    async (query: string, targetId?: string) => {
      const q = query.trim();
      if (!q) return;
      const id = targetId ?? nextId();
      if (targetId) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, loading: true, error: null } : t,
          ),
        );
      } else {
        setTabs((prev) => [
          ...prev.slice(-7),
          {
            id,
            kind: "search",
            url: q,
            title: `חיפוש: ${q.slice(0, 40)}`,
            loading: true,
            error: null,
          },
        ]);
      }
      setActiveId(id);
      setAddress("");
      try {
        const res = await fetch("/api/agent-browser/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q, s: sessionRef.current }),
        });
        const j = await res.json();
        setTabs((prev) =>
          prev.map((t) =>
            t.id === id
              ? j?.ok
                ? {
                    ...t,
                    loading: false,
                    results: j.results,
                    tookMs: j.tookMs,
                  }
                : { ...t, loading: false, error: String(j?.error ?? "שגיאה") }
              : t,
          ),
        );
        refreshChannels();
      } catch (e) {
        setTabs((prev) =>
          prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  loading: false,
                  error: e instanceof Error ? e.message : "שגיאת רשת",
                }
              : t,
          ),
        );
      }
    },
    [refreshChannels],
  );

  const submitAddress = useCallback(() => {
    const v = address.trim();
    if (!v) return;
    if (looksLikeUrl(v)) void openUrl(v);
    else void openSearch(v);
  }, [address, openUrl, openSearch]);

  const closeTab = useCallback(
    (id: string) => {
      if (id === "home") return;
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        const next = prev.filter((t) => t.id !== id);
        if (activeId === id) {
          setActiveId(next[Math.max(0, idx - 1)]?.id ?? "home");
        }
        return next;
      });
    },
    [activeId],
  );

  // ── הסוכן החי (צ'אט z.ai עם הקשר העמוד) ────────────────────────────
  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    setChatInput("");
    const nextChat: ChatMsg[] = [...chat, { role: "user", content: text }];
    setChat(nextChat);
    setChatBusy(true);
    const context =
      active?.kind === "read" && active.read
        ? {
            url: active.read.finalUrl,
            title: active.read.title,
            text: active.read.text.slice(0, 6_000),
          }
        : active?.kind === "search" && active.results
          ? {
              url: `search:${active.url}`,
              title: "תוצאות חיפוש",
              text: active.results
                .slice(0, 6)
                .map((r) => `${r.name} (${r.host_name}): ${r.snippet}`)
                .join("\n")
                .slice(0, 4_000),
            }
          : undefined;
    try {
      const res = await fetch("/api/agent-browser/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextChat,
          context,
          s: sessionRef.current,
        }),
      });
      const j = await res.json();
      if (j?.ok) {
        setChat([...nextChat, { role: "assistant", content: j.reply }]);
      } else {
        setChat([
          ...nextChat,
          {
            role: "assistant",
            content: `שגיאה: ${String(j?.error ?? "הפנייה נכשלה")}`,
          },
        ]);
      }
      refreshChannels();
    } catch (e) {
      setChat([
        ...nextChat,
        {
          role: "assistant",
          content: `שגיאה: ${e instanceof Error ? e.message : "שגיאת רשת"}`,
        },
      ]);
    } finally {
      setChatBusy(false);
    }
  }, [chat, chatBusy, chatInput, active, refreshChannels]);

  // ── קישורית חכמה: שמירה ושחזור ────────────────────────────────────
  const persistSession = useCallback(
    async (slug: string | null, title: string): Promise<string | null> => {
      const state: SessionState = {
        cards: tabs.map((t) => ({
          id: t.id,
          kind: t.kind,
          url: t.url,
          title: t.title,
        })),
        activeCard: activeId,
        chat: chat.slice(-20),
      };
      try {
        if (slug) {
          const res = await fetch(`/api/agent-browser/sessions/${slug}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state, title }),
          });
          if (res.ok) return slug;
        }
        const res = await fetch("/api/agent-browser/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, state }),
        });
        const j = await res.json();
        if (j?.ok) {
          setSession({ slug: j.slug, title, visits: 0 });
          return j.slug as string;
        }
        toast.error("יצירת הקישורית נכשלה", {
          description: String(j?.error ?? "שגיאה"),
        });
        return null;
      } catch (e) {
        toast.error("יצירת הקישורית נכשלה", {
          description: e instanceof Error ? e.message : "שגיאת רשת",
        });
        return null;
      }
    },
    [tabs, activeId, chat],
  );

  const createSmartLink = useCallback(async () => {
    const firstRead = tabs.find((t) => t.kind === "read");
    const title =
      (firstRead?.read?.title ?? firstRead?.title ?? tabs[1]?.title ?? "").slice(0, 60) ||
      "סשן דפדפן סוכנים";
    const slug = await persistSession(session?.slug ?? null, title);
    if (slug) {
      sessionRef.current = slug;
      const link = `${window.location.origin}/#/browser?s=${slug}`;
      toast.success(`הקישורית נוצרה: ${link}`, {
        description: "העתק ושתף — פותח את המצב הזה בדיוק, על כל דומיין שהאתר חי עליו",
        duration: 10_000,
      });
      void loadSaved();
    }
  }, [persistSession, session]);

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-browser/sessions", {
        cache: "no-store",
      });
      const j = await res.json();
      if (j?.ok) setSaved(j.sessions);
    } catch {
      /* רשימת הסשנים אינה קריטית */
    }
  }, []);

  // ── אתחול: שחזור קישורית (?s=) + מונים ────────────────────────────
  useEffect(() => {
    void (async () => {
      const slug =
        sessionSlug ??
        new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("s");
      if (slug && /^[a-z0-9]{4,16}$/.test(slug)) {
        try {
          const res = await fetch(`/api/agent-browser/sessions/${slug}`, {
            cache: "no-store",
          });
          const j = await res.json();
          if (j?.ok) {
            const st = j.session.state as SessionState;
            sessionRef.current = j.session.slug;
            setSession({
              slug: j.session.slug,
              title: j.session.title,
              visits: j.session.visits,
            });
            const restored: BrowserTab[] = (st.cards ?? [])
              .filter((c) => c.kind === "read" || c.kind === "search")
              .slice(0, 8)
              .map((c) => ({
                id: c.id,
                kind: c.kind,
                url: c.url,
                title: c.title || c.url.slice(0, 50),
                loading: false,
                error: null,
              }));
            if (restored.length > 0) {
              const homeTab: BrowserTab = {
                id: "home",
                kind: "home",
                url: "",
                title: "דף הבית",
                loading: false,
                error: null,
              };
              setTabs([homeTab, ...restored]);
              const act = restored.find((t) => t.id === st.activeCard);
              setActiveId(act?.id ?? restored[0].id);
              // רענון התוכן של הכרטיסית הפעילה — תוכן טרי, לא מטמון
              if (act?.kind === "read") void openUrl(act.url, act.id);
              else if (act?.kind === "search") void openSearch(act.url, act.id);
              if (Array.isArray(st.chat)) setChat(st.chat.slice(-20));
              toast.info(`סשן שוחזר: ${j.session.title}`, {
                description: `נפתח ${j.session.visits} פעמים · הכרטיסיות והשיחה חזרו במלואן`,
              });
            }
          }
        } catch {
          /* שחזור שקט */
        }
      }
      setRestoring(false);
      refreshChannels();
      void loadSaved();
    })();
  }, []);

  // גלילת הצ'אט לתחתית בכל הודעה חדשה
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, chatBusy]);

  const smartLinkUrl =
    session != null
      ? `${typeof window !== "undefined" ? window.location.origin : ""}/#/browser?s=${session.slug}`
      : null;

  const contextLabel =
    active?.kind === "read" && active.read
      ? `הקשר: ${active.read.title.slice(0, 40)}`
      : active?.kind === "search" && active.results
        ? "הקשר: תוצאות החיפוש"
        : "ללא הקשר עמוד";

  // ── רינדור ─────────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      {/* כותרת */}
      <FadeIn className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-500">
              <Compass className="size-6" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
                דפדפן הסוכנים
              </h1>
              <p className="mt-1 text-sm text-zinc-500">
                הגלישה החיה של הרשת — קריאה, חיפוש וסוכן AI, הכל דרך האתר שלך
                מחובר ל-z.ai
              </p>
            </div>
          </div>
          <Button
            onClick={() => void runConnectionTest()}
            disabled={testing}
            className="bg-emerald-600 font-semibold text-white hover:bg-emerald-500"
          >
            {testing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Radio className="size-4" aria-hidden />
            )}
            בדיקת חיבור חיה ל-z.ai
          </Button>
        </div>
      </FadeIn>

      {/* סרגל ערוצים — מונים נמדדים */}
      <FadeIn className="mb-5">
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              { key: "read", label: "קריאת עמודים", icon: FileText },
              { key: "search", label: "חיפוש רשת", icon: Search },
              { key: "chat", label: "סוכן LLM", icon: MessageSquare },
            ] as const
          ).map((ch) => {
            const st = channels?.[ch.key];
            return (
              <Card key={ch.key} className="border-zinc-800 bg-zinc-900/40">
                <CardContent className="flex items-center gap-3 p-3.5">
                  <ch.icon
                    className={cn(
                      "size-5 shrink-0",
                      st && st.count > 0 && st.lastOk !== false
                        ? "text-emerald-500"
                        : "text-zinc-500",
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-zinc-200">
                      {ch.label}
                    </p>
                    <p className="truncate text-[11px] text-zinc-500">
                      {st == null
                        ? "טוען מונים…"
                        : st.count === 0
                          ? "טרם נמדד בהפעלה הזו"
                          : `${st.count} קריאות · ממוצע ${st.avgMs} מ״ש${st.lastAt ? ` · אחרון ${new Date(st.lastAt).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}` : ""}`}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </FadeIn>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        {/* אזור הגלישה */}
        <div className="min-w-0">
          {/* שורת הכתובת */}
          <div className="mb-3 flex gap-2">
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute inset-y-0 end-3 my-auto size-4 text-zinc-500"
                aria-hidden
              />
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitAddress();
                }}
                placeholder="כתובת (example.com) או חיפוש חופשי — Enter לביצוע"
                className="border-zinc-700 bg-zinc-900/70 pe-10 font-mono text-sm text-zinc-100 placeholder:font-sans placeholder:text-zinc-600"
                dir="ltr"
                aria-label="שורת כתובת או חיפוש"
              />
            </div>
            <Button
              onClick={submitAddress}
              disabled={!address.trim()}
              className="bg-emerald-600 font-semibold text-white hover:bg-emerald-500"
            >
              <Wand2 className="size-4" aria-hidden />
              עבור
            </Button>
          </div>

          {/* פס כרטיסיות */}
          <div className="mb-3 flex items-center gap-1.5 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40 p-1.5 [scrollbar-width:thin]">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveId(t.id)}
                aria-current={activeId === t.id ? "true" : undefined}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors",
                  activeId === t.id
                    ? "border-emerald-600/50 bg-emerald-500/10 text-emerald-300"
                    : "border-transparent text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200",
                )}
              >
                {t.kind === "read" ? (
                  <Globe className="size-3.5" aria-hidden />
                ) : t.kind === "search" ? (
                  <Search className="size-3.5" aria-hidden />
                ) : (
                  <Compass className="size-3.5" aria-hidden />
                )}
                <span className="max-w-40 truncate" dir="auto">
                  {t.loading ? "טוען…" : t.title}
                </span>
                {t.id !== "home" && (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label="סגור כרטיסייה"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        closeTab(t.id);
                      }
                    }}
                    className="ms-0.5 rounded p-0.5 hover:bg-zinc-700/60"
                  >
                    <X className="size-3" aria-hidden />
                  </span>
                )}
              </button>
            ))}
            <span className="grow" />
            <span className="shrink-0 pe-1 text-[11px] text-zinc-600">
              {tabs.length}/8
            </span>
          </div>

          {/* תוכן הכרטיסייה */}
          <Card className="min-h-[420px] border-zinc-800 bg-zinc-950/50">
            <CardContent className="p-4 sm:p-5">
              {restoring ? (
                <div className="flex items-center justify-center gap-2 py-20 text-sm text-zinc-500">
                  <Loader2 className="size-5 animate-spin" aria-hidden />
                  {sessionSlug ? "משחזר סשן מהקישורית…" : "מכין את הדפדפן…"}
                </div>
              ) : active?.kind === "home" ? (
                <div className="py-8">
                  <div className="mx-auto max-w-md text-center">
                    <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-500">
                      <Compass className="size-7" aria-hidden />
                    </div>
                    <h2 className="mb-1 text-lg font-bold text-zinc-100">
                      לאן טסים היום?
                    </h2>
                    <p className="mb-6 text-sm leading-relaxed text-zinc-500">
                      הקלד כתובת בשורת הכתובת כדי לקרוא עמוד, או טקסט חופשי כדי
                      לחפש ברשת. הסוכן בצד ימין מכיר את מה שפתוח — שאל אותו
                      הכל.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {QUICK_LINKS.map((l) => (
                        <button
                          key={l.url}
                          type="button"
                          onClick={() => void openUrl(l.url)}
                          className="flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900/60 px-3.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-emerald-600/50 hover:text-emerald-300"
                        >
                          <Globe className="size-3.5" aria-hidden />
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {saved.length > 0 && (
                    <div className="mx-auto mt-8 max-w-lg">
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-400">
                        <Bookmark className="size-3.5" aria-hidden />
                        קישוריות חכמות שמורות
                      </p>
                      <div className="grid max-h-44 gap-1.5 overflow-y-auto [scrollbar-width:thin]">
                        {saved.map((s) => (
                          <a
                            key={s.slug}
                            href={`#/browser?s=${s.slug}`}
                            className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-xs transition-colors hover:border-emerald-700/50"
                          >
                            <span className="truncate text-zinc-300" dir="auto">
                              {s.title}
                            </span>
                            <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                              {s.visits} פתיחות
                            </span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : active ? (
                <TabBody tab={active} />
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* פאנל הסוכן */}
        <div className="flex min-w-0 flex-col gap-3">
          <Card className="flex min-h-[420px] flex-col border-zinc-800 bg-zinc-950/50">
            <CardContent className="flex min-h-0 flex-1 flex-col p-4">
              <div className="mb-3 flex items-center gap-2 border-b border-zinc-800 pb-3">
                <Sparkles className="size-4 text-emerald-500" aria-hidden />
                <p className="text-sm font-bold text-zinc-100">הסוכן החי</p>
                <Badge
                  variant="outline"
                  className="ms-auto border-zinc-700 text-[10px] text-zinc-400"
                >
                  z.ai · {contextLabel}
                </Badge>
              </div>
              <div className="mb-3 max-h-[46vh] grow space-y-2.5 overflow-y-auto [scrollbar-width:thin]">
                {chat.length === 0 && (
                  <div className="rounded-xl border border-dashed border-zinc-800 p-4 text-center text-xs leading-relaxed text-zinc-500">
                    הסוכן פועל דרך ה-AI של z.ai — מנוע השיחה חי בשרת של האתר.
                    פתח עמוד או בצע חיפוש, ואז שאל: "תמצת את העמוד", "מה
                    הנקודות החשובות?", או כל שאלה אחרת.
                  </div>
                )}
                {chat.map((m, i) => (
                  <div
                    key={i}
                    className={cn(
                      "max-w-[92%] rounded-xl px-3 py-2 text-[13px] leading-6",
                      m.role === "user"
                        ? "ms-auto bg-emerald-600/15 text-emerald-100"
                        : "me-auto border border-zinc-800 bg-zinc-900/60 text-zinc-300",
                    )}
                    dir="auto"
                  >
                    {m.content}
                  </div>
                ))}
                {chatBusy && (
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    הסוכן חושב…
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="flex gap-2">
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendChat();
                    }
                  }}
                  placeholder="שאל את הסוכן…"
                  className="border-zinc-700 bg-zinc-900/70 text-sm text-zinc-100"
                  aria-label="הודעה לסוכן"
                />
                <Button
                  onClick={() => void sendChat()}
                  disabled={chatBusy || !chatInput.trim()}
                  size="icon"
                  className="size-10 shrink-0 bg-emerald-600 text-white hover:bg-emerald-500"
                  aria-label="שלח לסוכן"
                >
                  <Send className="size-4" aria-hidden />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* קישורית חכמה */}
          <Card className="border-zinc-800 bg-zinc-950/50">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center gap-2">
                <Link2 className="size-4 text-[#e8cd6e]" aria-hidden />
                <p className="text-sm font-bold text-zinc-100">קישורית חכמה</p>
                {session && (
                  <Badge
                    variant="outline"
                    className="ms-auto border-[#d4af37]/40 text-[10px] text-[#e8cd6e]"
                  >
                    {session.visits} פתיחות
                  </Badge>
                )}
              </div>
              {smartLinkUrl ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/[0.06] p-2">
                    <code
                      className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#e8cd6e]"
                      dir="ltr"
                    >
                      {smartLinkUrl}
                    </code>
                    <CopyButton value={smartLinkUrl} label="הקישורית" />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => void createSmartLink()}
                      variant="outline"
                      size="sm"
                      className="h-8 flex-1 border-zinc-700 text-xs text-zinc-300"
                    >
                      <RefreshCw className="size-3.5" aria-hidden />
                      עדכון הקישורית
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-xs leading-relaxed text-zinc-500">
                    שומר את הסשן כולו — כרטיסיות פתוחות, העמוד הפעיל והשיחה
                    עם הסוכן — ומחזיר קישור אחד שמשחזר הכל. עובד על כל דומיין
                    שהאתר חי עליו.
                  </p>
                  <Button
                    onClick={() => void createSmartLink()}
                    className="w-full bg-[#d4af37] font-bold text-zinc-950 hover:bg-[#e8cd6e]"
                  >
                    <Link2 className="size-4" aria-hidden />
                    יצירת קישורית למצב הזה
                  </Button>
                </>
              )}
              <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-zinc-600">
                <ShieldCheck className="mt-0.5 size-3 shrink-0" aria-hidden />
                הקישורית נוצרת בשרת האתר עצמו — בלי שירותי-קיצור חיצוניים,
                בלי מעקב, בלי תלות באף ספק.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
