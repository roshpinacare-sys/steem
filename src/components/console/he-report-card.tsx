"use client";

// ─────────────────────────────────────────────────────────────────────────────
// HeReportCard — Task 85: הדוח-העברי-החי, בתוך הקונסולה.
// The daemon regenerates docs/REPORT_HE.md every 30 min and gitkeeper pushes
// it to the repo; this card serves the same file live in the UI — so the
// operator always has a Hebrew summary: in the repo AND on screen.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type HeReportData = {
  at?: string;
  mtime?: string;
  markdown?: string | null;
  error?: string;
};

function ago(iso?: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 1) return "עכשיו";
  if (m < 60) return `לפני ${m} דק׳`;
  const h = Math.floor(m / 60);
  if (h < 24) return `לפני ${h} שע׳`;
  return `לפני ${Math.floor(h / 24)} ימ׳`;
}

/** md-lite: headings / quotes / tables / lists / rules — enough for the report */
function renderMd(srcRaw: string) {
  const src = srcRaw.replace(/\*\*/g, ""); // we don't render bold — don't leak asterisks
  const lines = src.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  const isTableRow = (s: string) => /^\s*\|.*\|\s*$/.test(s);
  const isSepRow = (s: string) => /^\s*\|[\s:|-]+\|\s*$/.test(s);
  const cells = (s: string) =>
    s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    if (line.startsWith("### ")) {
      out.push(<div key={key++} className="mt-2 text-[13px] font-semibold text-amber-200">{line.slice(4)}</div>);
      i++; continue;
    }
    if (line.startsWith("## ")) {
      out.push(<div key={key++} className="mt-3 border-b border-zinc-800 pb-1 text-[14px] font-bold text-amber-300">{line.slice(3)}</div>);
      i++; continue;
    }
    if (line.startsWith("# ")) {
      out.push(<div key={key++} className="text-[16px] font-extrabold text-amber-300">{line.slice(2)}</div>);
      i++; continue;
    }
    if (line.startsWith("> ")) {
      out.push(
        <div key={key++} className="border-r-2 border-amber-800/60 pr-2 text-[11px] leading-relaxed text-zinc-400">
          {line.slice(2)}
        </div>,
      );
      i++; continue;
    }
    if (/^---+$/.test(line.trim())) {
      out.push(<div key={key++} className="my-2 border-t border-zinc-800" />);
      i++; continue;
    }

    // table block
    if (isTableRow(line)) {
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        if (!isSepRow(lines[i])) rows.push(cells(lines[i]));
        i++;
      }
      if (rows.length) {
        const [head, ...body] = rows;
        out.push(
          <div key={key++} className="mt-1 overflow-x-auto">
            <table className="w-full border-collapse text-[10.5px]">
              <thead>
                <tr>
                  {head.map((c, ci) => (
                    <th key={ci} className="border-b border-zinc-800 px-1.5 py-1 text-right font-semibold text-zinc-400">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((r, ri) => (
                  <tr key={ri} className="align-top">
                    {r.map((c, ci) => (
                      <td key={ci} className="border-b border-zinc-900 px-1.5 py-1 text-zinc-300">{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
      }
      continue;
    }

    out.push(
      <div key={key++} className="text-[11px] leading-relaxed text-zinc-300">
        {line.replace(/^\d+\.\s*/, (m) => m)}
      </div>,
    );
    i++;
  }
  return out;
}

export function HeReportCard() {
  const [d, setD] = useState<HeReportData | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/ops/he_report", { cache: "no-store" });
      setD(await r.json());
    } catch {
      setD({ error: "api unreachable" });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Card className="border-emerald-900/40 bg-emerald-400/[0.03]">
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <FileText className="h-4 w-4 text-emerald-400" aria-hidden />
          <span className="text-[13px] font-semibold text-emerald-300">דוח-הריבונות בעברית — חי ב-repo (85)</span>
          <Badge variant="outline" className="border-emerald-700/60 px-1.5 py-0 font-mono text-[10px] text-emerald-300">
            docs/REPORT_HE.md
          </Badge>
          {d?.mtime && <span className="text-[10px] text-zinc-500">נוצר {ago(d.mtime)}</span>}
          <Button variant="ghost" size="sm" className="ml-auto h-7 w-7 p-0 text-zinc-400 hover:text-emerald-300" onClick={load} disabled={busy} aria-label="רענון הדוח">
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <div className="mt-1 text-[11px] text-zinc-500">
          הדמון מייצר את הדוח כל 30 דק׳ (he_report.cjs) · gitkeeper דוחף אותו ל-repo · אותו קובץ מוצג כאן — סיכום עברי תמיד-טרי, בלי סינית.
        </div>

        <div className="report-he-scroll mt-3 max-h-96 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-3" dir="rtl">
          {d?.markdown ? (
            renderMd(d.markdown)
          ) : (
            <div className="text-[11px] text-zinc-500">
              {d?.error ? `הדוח עוד לא נוצר (${d.error}) — הלולאה תכתוב אותו תוך דקות` : "טוען דוח…"}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
