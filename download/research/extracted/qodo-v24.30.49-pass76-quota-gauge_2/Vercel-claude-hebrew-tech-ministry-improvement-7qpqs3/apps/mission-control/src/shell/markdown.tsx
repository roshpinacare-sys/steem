/**
 * markdown.tsx — a small, safe markdown renderer for the Docs page, Files
 * viewer, and release notes. Builds React elements directly (no
 * dangerouslySetInnerHTML, no dependency). Covers the subset this repo's docs
 * actually use: headings, paragraphs, fenced code (highlighted lazily),
 * blockquotes, lists (one nesting level), hr, pipe tables, inline
 * code/bold/italic/links/images.
 */
import React from "react";
import { UI, FONT, MONO } from "./ui.js";

const CodeViewLazy = React.lazy(() => import("./CodeView.js"));

export function MarkdownView({
  source,
  onOpenDoc,
  baseDir = "",
}: {
  source: string;
  /** Called for relative .md links so readers can navigate in-app. */
  onOpenDoc?: (path: string) => void;
  /** Directory of the current document, for resolving relative links. */
  baseDir?: string;
}): React.ReactElement {
  const blocks = parseBlocks(source);
  return (
    <div style={{ fontFamily: FONT, fontSize: 13.5, lineHeight: 1.65, color: UI.textSecondary, minWidth: 0 }}>
      {blocks.map((b, i) => renderBlock(b, i, { onOpenDoc, baseDir }))}
    </div>
  );
}

// ── Block model ──────────────────────────────────────────────────────────────

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "para"; text: string }
  | { kind: "code"; lang: string; code: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; items: { text: string; sub: string[] }[] }
  | { kind: "hr" }
  | { kind: "table"; header: string[]; rows: string[][] };

function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") { i++; continue; }

    // Fenced code
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const lang = fence[1] || "text";
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { buf.push(lines[i]); i++; }
      i++; // closing fence
      out.push({ kind: "code", lang, code: buf.join("\n") });
      continue;
    }

    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)/);
    if (h) { out.push({ kind: "heading", level: h[1].length, text: h[2].replace(/\s#+\s*$/, "") }); i++; continue; }

    // Horizontal rule
    if (/^(\s*[-*_]){3,}\s*$/.test(line)) { out.push({ kind: "hr" }); i++; continue; }

    // Blockquote
    if (line.startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
      out.push({ kind: "quote", text: buf.join(" ") });
      continue;
    }

    // Table (header row + |---| separator)
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") { rows.push(splitRow(lines[i])); i++; }
      out.push({ kind: "table", header, rows });
      continue;
    }

    // List
    const li = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)/);
    if (li) {
      const ordered = /^\d+\.$/.test(li[2]);
      const items: { text: string; sub: string[] }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)/);
        if (!m) break;
        if (m[1].length >= 2 && items.length > 0) items[items.length - 1].sub.push(m[3]);
        else items.push({ text: m[3], sub: [] });
        i++;
      }
      out.push({ kind: "list", ordered, items });
      continue;
    }

    // Paragraph (merge consecutive plain lines)
    const buf: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6}\s|```|>|\s*([-*]|\d+\.)\s|\s*[-*_]{3,}\s*$)/.test(lines[i]) && !(lines[i].includes("|") && i + 1 < lines.length && /-/.test(lines[i + 1]) && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]))) {
      buf.push(lines[i]);
      i++;
    }
    out.push({ kind: "para", text: buf.join(" ") });
  }
  return out;
}

function splitRow(line: string): string[] {
  return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
}

// ── Rendering ────────────────────────────────────────────────────────────────

interface Ctx { onOpenDoc?: (path: string) => void; baseDir: string }

const HEADING_STYLE: Record<number, React.CSSProperties> = {
  1: { fontSize: 20, fontWeight: 800, color: UI.textWhite, margin: "18px 0 10px" },
  2: { fontSize: 16.5, fontWeight: 700, color: UI.textWhite, margin: "22px 0 8px" },
  3: { fontSize: 14.5, fontWeight: 700, color: UI.textPrimary, margin: "18px 0 6px" },
  4: { fontSize: 13.5, fontWeight: 700, color: UI.textPrimary, margin: "14px 0 5px" },
  5: { fontSize: 13, fontWeight: 700, color: UI.textPrimary, margin: "12px 0 4px" },
  6: { fontSize: 12.5, fontWeight: 700, color: UI.textMuted, margin: "12px 0 4px" },
};

function renderBlock(b: Block, key: number, ctx: Ctx): React.ReactElement {
  switch (b.kind) {
    case "heading":
      return <div key={key} style={HEADING_STYLE[b.level]}>{inline(b.text, ctx)}</div>;
    case "para":
      return <p key={key} style={{ margin: "0 0 12px", overflowWrap: "break-word" }}>{inline(b.text, ctx)}</p>;
    case "code":
      return (
        <div key={key} style={{ margin: "0 0 14px", background: UI.bgPanel, border: `1px solid ${UI.border}`, borderRadius: 10, overflow: "hidden" }}>
          <React.Suspense fallback={<pre style={{ margin: 0, padding: "12px 14px", fontFamily: MONO, fontSize: 12, lineHeight: 1.6, overflowX: "auto", color: UI.textSecondary }}>{b.code}</pre>}>
            <CodeViewLazy code={b.code} language={b.lang} maxHeight={420} />
          </React.Suspense>
        </div>
      );
    case "quote":
      return (
        <blockquote key={key} style={{ margin: "0 0 12px", padding: "8px 14px", borderLeft: `3px solid ${UI.indigo}`, background: UI.bgPanel, borderRadius: "0 10px 10px 0", color: UI.textMuted }}>
          {inline(b.text, ctx)}
        </blockquote>
      );
    case "hr":
      return <div key={key} style={{ height: 1, background: UI.border, margin: "18px 0" }} />;
    case "list": {
      const Tag = b.ordered ? "ol" : "ul";
      return (
        <Tag key={key} style={{ margin: "0 0 12px", paddingLeft: 22 }}>
          {b.items.map((it, k) => (
            <li key={k} style={{ marginBottom: 4 }}>
              {inline(it.text, ctx)}
              {it.sub.length > 0 && (
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {it.sub.map((s, j) => <li key={j} style={{ marginBottom: 3 }}>{inline(s, ctx)}</li>)}
                </ul>
              )}
            </li>
          ))}
        </Tag>
      );
    }
    case "table":
      return (
        <div key={key} style={{ overflowX: "auto", margin: "0 0 14px", border: `1px solid ${UI.border}`, borderRadius: 10 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
            <thead>
              <tr>
                {b.header.map((h, k) => (
                  <th key={k} style={{ textAlign: "left", padding: "8px 12px", borderBottom: `1px solid ${UI.borderStrong}`, color: UI.textPrimary, fontWeight: 700, whiteSpace: "nowrap" }}>{inline(h, ctx)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, k) => (
                <tr key={k}>
                  {r.map((c, j) => (
                    <td key={j} style={{ padding: "7px 12px", borderBottom: k < b.rows.length - 1 ? `1px solid ${UI.border}` : "none", verticalAlign: "top" }}>{inline(c, ctx)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

// ── Inline formatting ────────────────────────────────────────────────────────

const INLINE = /(!?\[[^\]]*\]\([^)\s]+\))|(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;

function inline(text: string, ctx: Ctx): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push(<code key={k++} style={{ fontFamily: MONO, fontSize: "0.92em", background: UI.bgElevated, border: `1px solid ${UI.border}`, borderRadius: 5, padding: "1px 5px", color: UI.textPrimary }}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("**")) {
      out.push(<strong key={k++} style={{ color: UI.textPrimary }}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      out.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    } else {
      const link = tok.match(/^(!?)\[([^\]]*)\]\(([^)\s]+)\)$/);
      if (link) {
        const [, bang, label, url] = link;
        if (bang === "!") {
          out.push(/^https?:\/\//.test(url)
            ? <img key={k++} src={url} alt={label} style={{ maxWidth: "100%", borderRadius: 8, margin: "6px 0" }} />
            : <span key={k++} style={{ color: UI.textMuted, fontStyle: "italic" }}>[image: {label || url}]</span>);
        } else if (/^https?:\/\//.test(url)) {
          out.push(<a key={k++} href={url} target="_blank" rel="noopener noreferrer" style={{ color: UI.indigoLight, textDecoration: "none" }}>{label}</a>);
        } else if (/\.md(#.*)?$/i.test(url) && ctx.onOpenDoc) {
          const clean = url.split("#")[0];
          const resolved = resolvePath(ctx.baseDir, clean);
          out.push(
            <button key={k++} onClick={() => ctx.onOpenDoc?.(resolved)}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: UI.indigoLight, fontSize: "inherit", fontFamily: "inherit", textDecoration: "underline", textDecorationColor: `${UI.indigo}55` }}>
              {label}
            </button>,
          );
        } else {
          out.push(<span key={k++} style={{ color: UI.textPrimary }}>{label}</span>);
        }
      } else {
        out.push(tok);
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function resolvePath(baseDir: string, rel: string): string {
  if (rel.startsWith("/")) return rel.slice(1);
  const parts = (baseDir ? baseDir.split("/") : []).filter(Boolean);
  for (const seg of rel.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}
