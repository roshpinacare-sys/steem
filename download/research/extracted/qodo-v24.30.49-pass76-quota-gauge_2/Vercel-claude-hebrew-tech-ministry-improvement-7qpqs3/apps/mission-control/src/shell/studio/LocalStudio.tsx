/**
 * LocalStudio — the Studio's on-device runtime, used wherever WebContainers
 * cannot boot (the Android WebView has no cross-origin isolation, and some
 * networks block the runtime CDN). This is NOT a mock: Run assembles your
 * files into a document and executes it for real in a sandboxed iframe on
 * this device — real DOM, real JavaScript, real console output captured live.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UI, FONT, MONO, Pill, Button, Dot, EmptyState } from "../ui.js";
import { Icon } from "../icons.js";

const FILES_KEY = "qodo:studio-local-files";

const DEFAULT_FILES: Record<string, string> = {
  "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Qodo Studio</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main>
      <div class="badge">running on this device</div>
      <h1>Hello from <span>Qodo Studio</span></h1>
      <p>This page is your code, executed for real right here. Edit any file and press <b>Run</b>.</p>
      <button id="btn">Clicked <span id="n">0</span> times</button>
    </main>
    <script src="app.js"></script>
  </body>
</html>
`,
  "style.css": `:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: system-ui, sans-serif;
  background: radial-gradient(1200px 800px at 70% -10%, #1e1b4b, #070b16 60%); color: #e2e8f0; }
main { text-align: center; padding: 40px; max-width: 560px; }
.badge { display: inline-block; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: #a5b4fc;
  background: rgba(99,102,241,0.14); border: 1px solid rgba(99,102,241,0.35); padding: 5px 12px; border-radius: 999px; margin-bottom: 20px; }
h1 { font-size: 34px; margin: 0 0 14px; }
h1 span { background: linear-gradient(90deg, #818cf8, #34d399); -webkit-background-clip: text; background-clip: text; color: transparent; }
p { color: #94a3b8; line-height: 1.6; }
button { margin-top: 24px; padding: 12px 22px; font-size: 15px; font-weight: 600; color: #0a0e1a; cursor: pointer;
  background: linear-gradient(135deg, #818cf8, #6366f1); border: none; border-radius: 12px; }
`,
  "app.js": `let n = 0;
const btn = document.getElementById("btn");
const label = document.getElementById("n");
btn.addEventListener("click", () => { n += 1; label.textContent = String(n); console.log("clicked", n); });
console.log("app.js loaded — this is real execution on your device");
`,
};

const CAPTURE = `<script>(function(){
  function send(kind, args){ try { parent.postMessage({ __qodoConsole: true, kind: kind, text: args.map(function(a){ try { return typeof a === "object" ? JSON.stringify(a) : String(a); } catch(e) { return String(a); } }).join(" ") }, "*"); } catch(e) {} }
  ["log","info","warn","error"].forEach(function(k){ var orig = console[k].bind(console); console[k] = function(){ send(k, [].slice.call(arguments)); orig.apply(null, arguments); }; });
  window.addEventListener("error", function(e){ send("error", [e.message + (e.lineno ? " (line " + e.lineno + ")" : "")]); });
})();</script>`;

interface Line { id: number; text: string; kind: "out" | "cmd" | "sys" | "err" }

function loadFiles(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(FILES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) return parsed;
    }
  } catch { /* fall through to defaults */ }
  return { ...DEFAULT_FILES };
}

/** Assemble index.html with local files inlined + the console-capture hook. */
function buildDocument(files: Record<string, string>): string {
  let html = files["index.html"] ?? "<!doctype html><body><p>Create an index.html to preview.</p></body>";
  // Inline local stylesheets and scripts referenced by relative path.
  html = html.replace(/<link\b[^>]*href=["'](?:\.\/)?([^"']+)["'][^>]*\/?>/gi, (m, href: string) =>
    files[href] != null ? `<style>\n${files[href]}\n</style>` : m);
  html = html.replace(/<script\b[^>]*src=["'](?:\.\/)?([^"']+)["'][^>]*>\s*<\/script>/gi, (m, src: string) =>
    files[src] != null ? `<script>\n${files[src]}\n</script>` : m);
  // Console capture first, so even load-time logs are seen.
  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${CAPTURE}`);
  else html = CAPTURE + html;
  return html;
}

export function LocalStudio({ isMobile }: { isMobile: boolean }): React.ReactElement {
  const [files, setFiles] = useState<Record<string, string>>(loadFiles);
  const [active, setActive] = useState<string>("index.html");
  const [editor, setEditor] = useState<string>(() => loadFiles()["index.html"] ?? "");
  const [dirty, setDirty] = useState(false);
  const [right, setRight] = useState<"console" | "preview">("console");
  const [doc, setDoc] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([{ id: 0, text: "Local runtime ready — your code runs for real on this device.", kind: "sys" }]);
  const [newName, setNewName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const lineId = useRef(1);
  const consoleRef = useRef<HTMLDivElement>(null);

  const emit = useCallback((text: string, kind: Line["kind"]) => {
    setLines((prev) => {
      const next = [...prev, { id: lineId.current++, text, kind }];
      return next.length > 1500 ? next.slice(-1500) : next;
    });
  }, []);

  // Receive real console output from the executing document.
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const d = e.data as { __qodoConsole?: boolean; kind?: string; text?: string } | null;
      if (!d || !d.__qodoConsole) return;
      emit(`${d.kind === "log" ? "" : `[${d.kind}] `}${d.text ?? ""}`, d.kind === "error" ? "err" : "out");
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [emit]);

  useEffect(() => { consoleRef.current?.scrollTo({ top: 1e9 }); }, [lines]);

  const persist = useCallback((next: Record<string, string>) => {
    setFiles(next);
    try { window.localStorage.setItem(FILES_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const save = useCallback(() => {
    persist({ ...files, [active]: editor });
    setDirty(false);
  }, [files, active, editor, persist]);

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(save, 700);
    return () => clearTimeout(t);
  }, [editor, dirty, save]);

  const openFile = (path: string) => {
    setActive(path);
    setEditor(files[path] ?? "");
    setDirty(false);
  };

  const run = () => {
    const current = { ...files, [active]: editor };
    persist(current);
    setDirty(false);
    emit("$ run", "cmd");
    setDoc(buildDocument(current));
    setRight("preview");
    emit("document assembled — executing in the sandbox below", "sys");
  };

  const resetFiles = () => {
    persist({ ...DEFAULT_FILES });
    setActive("index.html");
    setEditor(DEFAULT_FILES["index.html"]);
    setDirty(false);
    setDoc(null);
    emit("workspace reset to the starter project", "sys");
  };

  const createFile = () => {
    const name = newName.trim();
    if (!name) return;
    persist({ ...files, [name]: "" });
    setShowNew(false);
    setNewName("");
    openFile(name);
  };

  const fileNames = useMemo(() => Object.keys(files).sort(), [files]);

  const lineColor = (k: Line["kind"]) =>
    k === "cmd" ? UI.green : k === "sys" ? UI.textMuted : k === "err" ? UI.red : UI.textSecondary;

  const consolePane = (
    <div ref={consoleRef} style={{ flex: 1, overflowY: "auto", padding: "10px 14px", fontFamily: MONO, fontSize: 12, lineHeight: 1.55 }}>
      {lines.map((l) => <div key={l.id} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: lineColor(l.kind) }}>{l.text}</div>)}
    </div>
  );

  const previewPane = doc != null
    ? <iframe title="preview" sandbox="allow-scripts" srcDoc={doc} style={{ flex: 1, border: "none", background: "#fff", width: "100%" }} />
    : <EmptyState icon="◲" title="No preview yet" hint="Press Run — your files execute right here, on this device." />;

  const tabs = (
    <div style={{ display: "flex", gap: 4, padding: "7px 12px", borderBottom: `1px solid ${UI.border}` }}>
      {(["console", "preview"] as const).map((t) => (
        <button key={t} onClick={() => setRight(t)} style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid transparent", cursor: "pointer", fontFamily: FONT, fontSize: 12.5, fontWeight: 600, textTransform: "capitalize", color: right === t ? UI.textWhite : UI.textMuted, background: right === t ? UI.bgActive : "transparent" }}>
          {t}{t === "preview" && doc != null ? " ●" : ""}
        </button>
      ))}
      <div style={{ flex: 1 }} />
      {right === "console" && <button onClick={() => setLines([])} style={{ background: "none", border: "none", color: UI.textMuted, cursor: "pointer", fontSize: 11.5 }}>clear</button>}
    </div>
  );

  const actionBar = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderBottom: `1px solid ${UI.border}`, flexWrap: "wrap" }}>
      <Pill color={UI.green}><Dot color={UI.green} glow size={7} /> Local runtime</Pill>
      <span style={{ fontSize: 12.5, color: UI.textMuted }}>on-device execution</span>
      <div style={{ flex: 1 }} />
      <Button variant="primary" color={UI.green} onClick={run}><Icon name="dispatch" size={14} /> Run</Button>
      <Button color={UI.red} onClick={resetFiles}>Reset</Button>
    </div>
  );

  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {actionBar}
        <div style={{ display: "flex", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${UI.border}`, alignItems: "center" }}>
          <select value={active} onChange={(e) => openFile(e.target.value)}
            style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 12.5, padding: "8px 10px", borderRadius: 8, background: UI.bgElevated, border: `1px solid ${UI.borderStrong}`, color: UI.textPrimary, outline: "none" }}>
            {fileNames.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <button onClick={() => setShowNew((v) => !v)} style={{ background: "none", border: "none", color: UI.indigoLight, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>＋</button>
          <button onClick={save} disabled={!dirty} style={{ background: "none", border: "none", cursor: dirty ? "pointer" : "default", color: dirty ? UI.indigoLight : UI.textMuted, fontSize: 13, fontWeight: 600, fontFamily: FONT }}>Save</button>
        </div>
        {showNew && (
          <div style={{ padding: "8px 14px", borderBottom: `1px solid ${UI.border}`, display: "flex", gap: 6 }}>
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createFile()}
              placeholder="new-file.js" spellCheck={false}
              style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontFamily: MONO, padding: "7px 9px", borderRadius: 8, background: UI.bgElevated, border: `1px solid ${UI.borderStrong}`, color: UI.textPrimary, outline: "none" }} />
            <Button onClick={createFile}>Add</Button>
          </div>
        )}
        <textarea value={editor} onChange={(e) => { setEditor(e.target.value); setDirty(true); }} spellCheck={false}
          style={{ flex: 1, minHeight: 0, resize: "none", border: "none", outline: "none", padding: "12px 14px", background: "transparent", color: UI.textPrimary, fontFamily: MONO, fontSize: 12.5, lineHeight: 1.6, borderBottom: `1px solid ${UI.border}` }} />
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {tabs}
          {right === "console" ? consolePane : previewPane}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {actionBar}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "190px minmax(0, 1fr) minmax(0, 1fr)", minHeight: 0 }}>
        <div style={{ borderRight: `1px solid ${UI.border}`, overflowY: "auto", padding: "10px 8px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 8px 8px" }}>
            <span style={{ fontSize: 10.5, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700, color: UI.textMuted }}>Files</span>
            <button title="New file" onClick={() => setShowNew((v) => !v)} style={{ background: "none", border: "none", color: UI.indigoLight, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>＋</button>
          </div>
          {showNew && (
            <div style={{ padding: "0 4px 8px", display: "flex", gap: 4 }}>
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createFile()}
                placeholder="new-file.js" spellCheck={false}
                style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: MONO, padding: "5px 7px", borderRadius: 7, background: UI.bgElevated, border: `1px solid ${UI.borderStrong}`, color: UI.textPrimary, outline: "none" }} />
            </div>
          )}
          {fileNames.map((f) => (
            <button key={f} onClick={() => openFile(f)}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "5px 8px", borderRadius: 7, marginBottom: 1, fontFamily: MONO, fontSize: 12, cursor: "pointer", border: "1px solid transparent", color: active === f ? UI.textWhite : UI.textSecondary, background: active === f ? UI.bgActive : "transparent" }}>
              {f}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, borderRight: `1px solid ${UI.border}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", borderBottom: `1px solid ${UI.border}` }}>
            <span style={{ fontFamily: MONO, fontSize: 12, color: UI.textSecondary }}>{active}{dirty ? " •" : ""}</span>
            <button onClick={save} disabled={!dirty} style={{ background: "none", border: "none", cursor: dirty ? "pointer" : "default", color: dirty ? UI.indigoLight : UI.textMuted, fontSize: 12, fontWeight: 600, fontFamily: FONT }}>Save</button>
          </div>
          <textarea value={editor}
            onChange={(e) => { setEditor(e.target.value); setDirty(true); }}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); } }}
            spellCheck={false}
            style={{ flex: 1, resize: "none", border: "none", outline: "none", padding: "12px 14px", background: "transparent", color: UI.textPrimary, fontFamily: MONO, fontSize: 12.5, lineHeight: 1.6, tabSize: 2 }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          {tabs}
          {right === "console" ? consolePane : previewPane}
        </div>
      </div>
    </div>
  );
}
