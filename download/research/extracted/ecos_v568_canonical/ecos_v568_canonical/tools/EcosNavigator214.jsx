import { useState, useRef, useCallback } from "react";

// ─── PALETTE (matches researchTool214) ───────────────────────────────────────
const C = {
  bg:      "#060e06",
  panel:   "#0c150c",
  border:  "#1a2a1a",
  border2: "#243424",
  green:   "#44ff88",
  green2:  "#a0c8a0",
  green3:  "#506050",
  amber:   "#ffaa44",
  red:     "#ff4444",
  blue:    "#44aaff",
  purple:  "#cc88ff",
  dim:     "#344434",
  text:    "#c8e8c8",
  muted:   "#8aaa8a",
};

const mono = "'JetBrains Mono','Fira Code','Courier New',monospace";

// ─── TINY HELPERS ─────────────────────────────────────────────────────────────
const Pill = ({ children, color = C.green, bg = "#0a1a0a" }) => (
  <span style={{
    fontFamily: mono, fontSize: 10, fontWeight: 700,
    background: bg, color, border: `1px solid ${color}22`,
    padding: "1px 7px", borderRadius: 2, letterSpacing: "0.06em",
    whiteSpace: "nowrap",
  }}>{children}</span>
);

const SectionTitle = ({ icon, label, sub }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14, borderBottom: `1px solid ${C.border}`, paddingBottom: 8 }}>
    <span style={{ fontSize: 14 }}>{icon}</span>
    <span style={{ fontFamily: mono, fontSize: 12, color: C.green2, fontWeight: 700, letterSpacing: "0.07em" }}>{label}</span>
    {sub && <span style={{ fontFamily: mono, fontSize: 10, color: C.green3 }}>{sub}</span>}
  </div>
);

const CopyBtn = ({ text, label = "העתק" }) => {
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    });
  };
  return (
    <button onClick={copy} style={{
      fontFamily: mono, fontSize: 10, fontWeight: 700,
      background: done ? "#0a2a0a" : "#0c180c",
      color: done ? C.green : C.green3,
      border: `1px solid ${done ? C.green + "44" : C.border2}`,
      padding: "3px 10px", borderRadius: 2, cursor: "pointer",
      transition: "all 0.2s", letterSpacing: "0.06em",
    }}>{done ? "✓ הועתק" : label}</button>
  );
};

const CodeBlock = ({ text, lang = "" }) => (
  <div style={{ position: "relative" }}>
    <pre style={{
      fontFamily: mono, fontSize: 10.5, color: C.green2, lineHeight: 1.7,
      background: "#08100808", border: `1px solid ${C.border}`,
      borderRadius: 3, padding: "10px 12px", margin: 0,
      overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
    }}>{text}</pre>
    <div style={{ position: "absolute", top: 6, right: 8 }}>
      <CopyBtn text={text} />
    </div>
  </div>
);

const Row = ({ label, value, color = C.text, mono: isMono = false }) => (
  <div style={{ display: "flex", gap: 10, marginBottom: 5, alignItems: "flex-start" }}>
    <span style={{ fontFamily: mono, fontSize: 10, color: C.green3, minWidth: 160, flexShrink: 0 }}>{label}</span>
    <span style={{ fontFamily: isMono ? mono : "inherit", fontSize: isMono ? 10.5 : 12, color, lineHeight: 1.5 }}>{value}</span>
  </div>
);

// ─── ZIP PARSER ───────────────────────────────────────────────────────────────
async function readZipFile(file) {
  // Use JSZip via CDN — imported dynamically
  const JSZip = (await import("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js")).default;
  const zip = await JSZip.loadAsync(file);
  return zip;
}

function getRoot(zip) {
  const names = Object.keys(zip.files);
  const first = names.find(n => n.includes("/"));
  return first ? first.split("/")[0] + "/" : "";
}

async function extractText(zip, path) {
  const f = zip.files[path];
  if (!f || f.dir) return null;
  try { return await f.async("text"); } catch { return null; }
}

// ─── ANALYSIS ENGINE ──────────────────────────────────────────────────────────
async function analyzeZip(zip) {
  const root = getRoot(zip);
  const files = Object.keys(zip.files);

  // ── 1. Find latest version from package.json ──
  const pkgRaw = await extractText(zip, `${root}package.json`);
  const pkg = pkgRaw ? JSON.parse(pkgRaw) : {};
  const version = pkg.version || "?";
  const vNum = parseInt(version);

  // ── 2. Latest NEXT_SESSION_PROMPT ──
  const nspFiles = files
    .filter(f => f.includes("NEXT_SESSION_PROMPT_V") && f.endsWith(".md"))
    .map(f => ({ path: f, v: parseInt(f.match(/V(\d+)/)?.[1] || "0") }))
    .sort((a, b) => b.v - a.v);
  const latestNSP = nspFiles[0];
  const nspText = latestNSP ? await extractText(zip, latestNSP.path) : null;

  // ── 3. Latest AI_PROTOCOL ──
  const apFiles = files
    .filter(f => f.includes("AI_PROTOCOL_V") && f.endsWith(".md"))
    .map(f => ({ path: f, v: parseInt(f.match(/V(\d+)/)?.[1] || "0") }))
    .sort((a, b) => b.v - a.v);
  const latestAP = apFiles[0];
  const apText = latestAP ? await extractText(zip, latestAP.path) : null;

  // ── 4. Latest CHANGELOG ──
  const clFiles = files
    .filter(f => /CHANGELOG_V\d+\.md/.test(f))
    .map(f => ({ path: f, v: parseInt(f.match(/V(\d+)/)?.[1] || "0") }))
    .sort((a, b) => b.v - a.v);
  const latestCL = clFiles[0];
  const clText = latestCL ? await extractText(zip, latestCL.path) : null;

  // ── 5. CLAUDE.md ──
  const claudeMd = await extractText(zip, `${root}CLAUDE.md`);

  // ── 6. Lib inventory ──
  const libFiles = files
    .filter(f => /\/lib\/[^/]+\.js$/.test(f))
    .map(f => {
      const name = f.split("/").pop();
      const vMatch = name.match(/(\d+)\.js$/);
      return { name, v: vMatch ? parseInt(vMatch[1]) : 0, path: f };
    })
    .sort((a, b) => b.v - a.v);

  // ── 7. Endpoint count from server ──
  const serverRaw = await extractText(zip, `${root}ecos-api-server.js`);
  let endpoints = [];
  let stores = [];
  let md5Sacred = { fiatLedger: null, auditLog: null };
  if (serverRaw) {
    // Extract recent endpoints (last N matching version)
    const epRgx = /app\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    let m;
    while ((m = epRgx.exec(serverRaw)) !== null) {
      endpoints.push({ method: m[1].toUpperCase(), path: m[2] });
    }
    // Extract stores (_xxxNNN = )
    const storeRgx = /const (_[a-zA-Z]+\d+)\s*=/g;
    const storeSet = new Set();
    while ((m = storeRgx.exec(serverRaw)) !== null) storeSet.add(m[1]);
    stores = [...storeSet].filter(s => /\d{3,}/.test(s)).sort();
  }

  // ── 8. Sacred MD5s from NEXT_SESSION_PROMPT ──
  if (nspText) {
    const fl = nspText.match(/fiatLedger\.js[^0-9a-f]*([0-9a-f]{8})/i);
    const al = nspText.match(/auditLog\.js[^0-9a-f]*([0-9a-f]{8})/i);
    if (fl) md5Sacred.fiatLedger = fl[1] + "…";
    if (al) md5Sacred.auditLog = al[1] + "…";
  }

  // ── 9. Tests inventory ──
  const testFiles = files
    .filter(f => /\/tests\/v\d+\.test\.js/.test(f))
    .map(f => parseInt(f.match(/v(\d+)\.test/)?.[1] || "0"))
    .sort((a, b) => b - a);

  // ── 10. Recent endpoints (version-tagged) ──
  const vTaggedEndpoints = endpoints.filter(e =>
    e.path.includes(`v${vNum}`) || e.path.includes(`/v${vNum - 1}`) || e.path.includes(`/v${vNum - 2}`)
  );
  const recentEndpoints = endpoints.slice(-30); // last 30

  // ── 11. Build session context block ──
  const nextV = vNum + 1;
  const sessionBlock = buildSessionBlock({
    version, nextV, nspText, latestNSP, apText, latestAP, md5Sacred,
    libFiles, stores, testFiles, recentEndpoints, pkg,
  });

  return {
    version, nextV, root,
    nspText, latestNSP,
    apText, latestAP,
    clText, latestCL,
    claudeMd,
    libFiles,
    stores,
    endpoints,
    recentEndpoints,
    testFiles,
    md5Sacred,
    sessionBlock,
    totalFiles: files.filter(f => !zip.files[f].dir).length,
    pkg,
  };
}

function buildSessionBlock({ version, nextV, nspText, latestNSP, md5Sacred, libFiles, stores, testFiles }) {
  const lines = [];
  lines.push(`# ECOS V${nextV} — Session Context (auto-generated by ecosNavigator)`);
  lines.push(`# Source: ecos_v${version.replace(/\./g, "_")}_canonical.zip`);
  lines.push("");

  if (nspText) {
    // Extract pre-flight block
    const preflightMatch = nspText.match(/```[\s\S]*?```/);
    if (preflightMatch) {
      lines.push("## Pre-flight");
      lines.push(preflightMatch[0]);
      lines.push("");
    }
    // Extract invariants
    const invMatch = nspText.match(/## Invariants\n([\s\S]*?)(\n## |$)/);
    if (invMatch) {
      lines.push("## Invariants");
      lines.push(invMatch[1].trim());
      lines.push("");
    }
    // Extract chain notes
    const chainMatch = nspText.match(/## Chain notes[\s\S]*?(\n## |$)/);
    if (chainMatch) {
      lines.push(chainMatch[0].replace(/\n## $/, "").trim());
      lines.push("");
    }
    // Suggested work
    const suggestedMatch = nspText.match(/## Suggested[\s\S]*/);
    if (suggestedMatch) {
      lines.push(suggestedMatch[0].trim());
      lines.push("");
    }
  }

  lines.push("## Sacred MD5");
  lines.push(`- fiatLedger.js: ${md5Sacred.fiatLedger || "see NEXT_SESSION_PROMPT"}`);
  lines.push(`- auditLog.js:   ${md5Sacred.auditLog || "see NEXT_SESSION_PROMPT"}`);
  lines.push("");

  lines.push("## Recent lib files (last 10 by version)");
  libFiles.slice(0, 10).forEach(l => lines.push(`- ${l.name}`));
  lines.push("");

  lines.push("## Active stores (version-tagged, last 15)");
  stores.slice(-15).forEach(s => lines.push(`- ${s}`));
  lines.push("");

  lines.push("## Test suites (latest versions)");
  lines.push(testFiles.slice(0, 8).map(v => `v${v}.test.js`).join("  "));
  lines.push("");

  lines.push(`## Next version: V${nextV}`);
  lines.push(`- All new identifiers: suffix ...${nextV}`);
  lines.push(`- Variable names: req${nextV}<letter>, res${nextV}<letter>, err${nextV}<letter>`);

  return lines.join("\n");
}

// ─── TAB BAR ─────────────────────────────────────────────────────────────────
const TABS = [
  { id: "session",   label: "🚀 Session",    desc: "להעתיק לסשן" },
  { id: "state",     label: "📍 State",      desc: "מצב נוכחי" },
  { id: "libs",      label: "📦 Libs",       desc: "ספריות" },
  { id: "endpoints", label: "🔌 Endpoints",  desc: "נקודות קצה" },
  { id: "prompts",   label: "📄 Prompts",    desc: "NSP / Protocol" },
  { id: "changelog", label: "📝 Changelog",  desc: "שינויים" },
];

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function ECOSNavigator() {
  const [phase, setPhase] = useState("idle"); // idle | loading | done | error
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("session");
  const [epFilter, setEpFilter] = useState("");
  const [libFilter, setLibFilter] = useState("");
  const dropRef = useRef(null);
  const inputRef = useRef(null);

  const processFile = useCallback(async (file) => {
    if (!file || !file.name.endsWith(".zip")) {
      setError("נא להעלות קובץ ZIP בלבד");
      return;
    }
    setPhase("loading");
    setError(null);
    setData(null);
    try {
      const zip = await readZipFile(file);
      const result = await analyzeZip(zip);
      setData(result);
      setPhase("done");
      setTab("session");
    } catch (e) {
      setError(e.message || "שגיאה בעיבוד הקובץ");
      setPhase("error");
    }
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    dropRef.current?.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const onDragOver = (e) => { e.preventDefault(); dropRef.current?.classList.add("drag-over"); };
  const onDragLeave = () => dropRef.current?.classList.remove("drag-over");
  const onFileChange = (e) => { if (e.target.files[0]) processFile(e.target.files[0]); };

  return (
    <div style={{
      background: C.bg, minHeight: "100vh", color: C.text,
      fontFamily: "'IBM Plex Sans', 'Segoe UI', sans-serif",
      padding: 0, margin: 0,
    }}>
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border2}; border-radius: 2px; }
        .drag-over { border-color: ${C.green} !important; background: #0a1a0a !important; }
        .tab-btn:hover { background: #111f11 !important; color: ${C.green2} !important; }
        .ep-row:hover { background: #0d1a0d !important; }
        input[type=text] { outline: none; }
        input[type=text]:focus { border-color: ${C.green3} !important; }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{
        borderBottom: `1px solid ${C.border}`,
        padding: "12px 20px",
        display: "flex", alignItems: "center", gap: 12,
        background: "#08100808",
      }}>
        <span style={{ fontFamily: mono, fontSize: 18, color: C.green, fontWeight: 900, letterSpacing: "0.05em" }}>⬡</span>
        <div>
          <div style={{ fontFamily: mono, fontSize: 13, color: C.green2, fontWeight: 700, letterSpacing: "0.08em" }}>ECOS NAVIGATOR</div>
          <div style={{ fontFamily: mono, fontSize: 9, color: C.green3, letterSpacing: "0.12em" }}>ZIP CONTEXT EXTRACTOR — V214</div>
        </div>
        {data && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <Pill color={C.green}>V{data.version}</Pill>
            <Pill color={C.amber}>{data.totalFiles} files</Pill>
            <Pill color={C.blue}>{data.libFiles.length} libs</Pill>
            <Pill color={C.purple}>{data.endpoints.length} endpoints</Pill>
          </div>
        )}
      </div>

      {/* ── DROP ZONE (when idle/error) ── */}
      {phase !== "done" && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "calc(100vh - 53px)", padding: 20 }}>
          <div style={{ width: "100%", maxWidth: 520, textAlign: "center" }}>

            {phase === "loading" && (
              <div>
                <Spinner large />
                <div style={{ fontFamily: mono, fontSize: 12, color: C.green3, marginTop: 16, letterSpacing: "0.1em" }}>
                  מנתח את הזיפ...
                </div>
              </div>
            )}

            {phase !== "loading" && (
              <>
                <div
                  ref={dropRef}
                  onDrop={onDrop}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onClick={() => inputRef.current?.click()}
                  style={{
                    border: `2px dashed ${C.border2}`,
                    borderRadius: 4,
                    padding: "48px 24px",
                    cursor: "pointer",
                    transition: "all 0.2s",
                    background: C.panel,
                  }}
                >
                  <div style={{ fontSize: 36, marginBottom: 12 }}>📦</div>
                  <div style={{ fontFamily: mono, fontSize: 14, color: C.green2, marginBottom: 6, fontWeight: 700 }}>
                    גרור כאן את הזיפ
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 11, color: C.green3, marginBottom: 16 }}>
                    ecos_v21x_canonical.zip
                  </div>
                  <div style={{
                    fontFamily: mono, fontSize: 10, color: C.green3,
                    border: `1px solid ${C.border}`, display: "inline-block",
                    padding: "5px 16px", borderRadius: 2,
                  }}>
                    או לחץ לבחירת קובץ
                  </div>
                  <input ref={inputRef} type="file" accept=".zip" onChange={onFileChange} style={{ display: "none" }} />
                </div>

                {error && (
                  <div style={{
                    marginTop: 16, fontFamily: mono, fontSize: 11, color: C.red,
                    background: "#1a0808", border: `1px solid ${C.red}33`,
                    borderRadius: 3, padding: "8px 14px",
                  }}>
                    ⚠ {error}
                  </div>
                )}

                <div style={{ marginTop: 24, fontFamily: mono, fontSize: 10, color: C.dim, lineHeight: 1.8 }}>
                  הכלי פועל לוקאלית בדפדפן בלבד · אין העלאה לשרת · ZIP לא נשמר
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── MAIN PANEL ── */}
      {phase === "done" && data && (
        <div style={{ display: "flex", height: "calc(100vh - 53px)" }}>

          {/* Tab sidebar */}
          <div style={{
            width: 140, borderRight: `1px solid ${C.border}`,
            background: "#08100808", flexShrink: 0, paddingTop: 8,
          }}>
            {TABS.map(t => (
              <button
                key={t.id}
                className="tab-btn"
                onClick={() => setTab(t.id)}
                style={{
                  width: "100%", textAlign: "left",
                  background: tab === t.id ? "#0d1a0d" : "transparent",
                  color: tab === t.id ? C.green : C.green3,
                  border: "none", borderLeft: tab === t.id ? `2px solid ${C.green}` : "2px solid transparent",
                  fontFamily: mono, fontSize: 10, fontWeight: 700,
                  padding: "9px 12px", cursor: "pointer",
                  display: "block", letterSpacing: "0.04em",
                  transition: "all 0.15s",
                }}
              >
                <div>{t.label}</div>
                <div style={{ fontWeight: 400, fontSize: 9, color: tab === t.id ? C.green3 : C.dim, marginTop: 2 }}>{t.desc}</div>
              </button>
            ))}

            {/* Re-load button */}
            <div style={{ padding: "12px 10px", marginTop: "auto", borderTop: `1px solid ${C.border}`, position: "absolute", bottom: 0, width: 140 }}>
              <button
                onClick={() => { setPhase("idle"); setData(null); setError(null); }}
                style={{
                  width: "100%", fontFamily: mono, fontSize: 9, fontWeight: 700,
                  color: C.green3, background: "transparent", border: `1px solid ${C.border}`,
                  borderRadius: 2, padding: "5px 0", cursor: "pointer", letterSpacing: "0.06em",
                }}
              >↑ טען זיפ חדש</button>
            </div>
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

            {/* ═══ SESSION TAB ═══ */}
            {tab === "session" && (
              <div>
                <SectionTitle icon="🚀" label="SESSION CONTEXT BLOCK" sub="— העתק לסשן עם Claude" />
                <div style={{ marginBottom: 14, fontFamily: mono, fontSize: 11, color: C.muted, lineHeight: 1.7 }}>
                  זהו הטקסט המינימלי שClaude צריך בתחילת סשן.
                  <br />במקום להעלות את כל הזיפ — העתק רק את זה.
                </div>
                <div style={{ marginBottom: 10, display: "flex", gap: 8 }}>
                  <CopyBtn text={data.sessionBlock} label="📋 העתק הכל לסשן" />
                </div>
                <CodeBlock text={data.sessionBlock} />

                <div style={{ marginTop: 20 }}>
                  <SectionTitle icon="🔐" label="SACRED MD5" sub="— לאמת בתחילת כל סשן" />
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 3, padding: "10px 14px" }}>
                      <div style={{ fontFamily: mono, fontSize: 9, color: C.green3, marginBottom: 4 }}>fiatLedger.js</div>
                      <div style={{ fontFamily: mono, fontSize: 12, color: C.green }}>
                        {data.md5Sacred.fiatLedger || <span style={{ color: C.amber }}>לא נמצא — בדוק NEXT_SESSION_PROMPT</span>}
                      </div>
                    </div>
                    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 3, padding: "10px 14px" }}>
                      <div style={{ fontFamily: mono, fontSize: 9, color: C.green3, marginBottom: 4 }}>auditLog.js</div>
                      <div style={{ fontFamily: mono, fontSize: 12, color: C.green }}>
                        {data.md5Sacred.auditLog || <span style={{ color: C.amber }}>לא נמצא — בדוק NEXT_SESSION_PROMPT</span>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ═══ STATE TAB ═══ */}
            {tab === "state" && (
              <div>
                <SectionTitle icon="📍" label="PROJECT STATE" sub={`— ecos_v${data.version}_canonical`} />

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                  {[
                    ["גרסה נוכחית", `V${data.version}`, C.green],
                    ["גרסה הבאה", `V${data.nextV}`, C.amber],
                    ["קבצים בזיפ", data.totalFiles, C.blue],
                    ["ספריות (lib)", data.libFiles.length, C.purple],
                    ["Endpoints", data.endpoints.length, C.green],
                    ["Test suites", data.testFiles.length, C.green2],
                    ["Stores versioned", data.stores.length, C.amber],
                    ["Latest test", data.testFiles[0] ? `v${data.testFiles[0]}` : "?", C.blue],
                  ].map(([label, val, col]) => (
                    <div key={label} style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 3, padding: "10px 14px" }}>
                      <div style={{ fontFamily: mono, fontSize: 9, color: C.green3, marginBottom: 4, letterSpacing: "0.1em" }}>{label}</div>
                      <div style={{ fontFamily: mono, fontSize: 16, color: col, fontWeight: 900 }}>{val}</div>
                    </div>
                  ))}
                </div>

                <SectionTitle icon="🗃️" label="IN-MEMORY STORES" sub={`(${data.stores.length} versioned)`} />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
                  {data.stores.slice(-30).map(s => (
                    <Pill key={s} color={C.purple} bg="#1a0a2a">{s}</Pill>
                  ))}
                </div>

                <SectionTitle icon="🧪" label="TEST SUITES" sub="(newest first)" />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {data.testFiles.slice(0, 20).map(v => (
                    <Pill key={v} color={C.blue} bg="#0a1020">v{v}.test.js</Pill>
                  ))}
                </div>
              </div>
            )}

            {/* ═══ LIBS TAB ═══ */}
            {tab === "libs" && (
              <div>
                <SectionTitle icon="📦" label="LIB INVENTORY" sub={`(${data.libFiles.length} files)`} />
                <input
                  type="text"
                  value={libFilter}
                  onChange={e => setLibFilter(e.target.value)}
                  placeholder="חפש ספרייה..."
                  style={{
                    width: "100%", marginBottom: 12,
                    background: C.panel, border: `1px solid ${C.border2}`,
                    color: C.text, fontFamily: mono, fontSize: 11,
                    padding: "7px 10px", borderRadius: 3,
                  }}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {data.libFiles
                    .filter(l => !libFilter || l.name.toLowerCase().includes(libFilter.toLowerCase()))
                    .map(l => (
                      <div key={l.name} className="ep-row" style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "5px 8px", borderRadius: 2,
                        transition: "background 0.1s",
                      }}>
                        <Pill color={l.v >= parseInt(data.version) - 3 ? C.green : C.green3}
                              bg={l.v >= parseInt(data.version) - 3 ? "#0a1a0a" : "#0c0f0c"}>
                          V{l.v || "—"}
                        </Pill>
                        <span style={{ fontFamily: mono, fontSize: 11, color: l.v >= parseInt(data.version) - 5 ? C.text : C.muted }}>
                          {l.name}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* ═══ ENDPOINTS TAB ═══ */}
            {tab === "endpoints" && (
              <div>
                <SectionTitle icon="🔌" label="ENDPOINTS" sub={`(${data.endpoints.length} total)`} />
                <input
                  type="text"
                  value={epFilter}
                  onChange={e => setEpFilter(e.target.value)}
                  placeholder="חפש endpoint... (e.g. /admin, /tasks, POST)"
                  style={{
                    width: "100%", marginBottom: 12,
                    background: C.panel, border: `1px solid ${C.border2}`,
                    color: C.text, fontFamily: mono, fontSize: 11,
                    padding: "7px 10px", borderRadius: 3,
                  }}
                />
                <div style={{ fontFamily: mono, fontSize: 10, color: C.green3, marginBottom: 8 }}>
                  מציג {Math.min(
                    data.endpoints.filter(e => !epFilter ||
                      e.path.toLowerCase().includes(epFilter.toLowerCase()) ||
                      e.method.toLowerCase().includes(epFilter.toLowerCase())
                    ).length, 200
                  )} תוצאות
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                      {["METHOD", "PATH"].map(h => (
                        <th key={h} style={{ fontFamily: mono, fontSize: 9, color: C.green3, padding: "6px 10px", textAlign: "left", letterSpacing: "0.12em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.endpoints
                      .filter(e => !epFilter ||
                        e.path.toLowerCase().includes(epFilter.toLowerCase()) ||
                        e.method.toLowerCase().includes(epFilter.toLowerCase())
                      )
                      .slice(-200)
                      .reverse()
                      .map((e, i) => {
                        const mColor = { GET: C.green, POST: C.amber, PUT: C.blue, PATCH: C.purple, DELETE: C.red }[e.method] || C.text;
                        return (
                          <tr key={i} className="ep-row" style={{ borderBottom: `1px solid #0d140d`, transition: "background 0.1s" }}>
                            <td style={{ padding: "4px 10px", fontFamily: mono, fontSize: 10, color: mColor, fontWeight: 700, minWidth: 60 }}>{e.method}</td>
                            <td style={{ padding: "4px 10px", fontFamily: mono, fontSize: 10, color: C.muted }}>{e.path}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ═══ PROMPTS TAB ═══ */}
            {tab === "prompts" && (
              <div>
                {data.nspText && (
                  <>
                    <SectionTitle
                      icon="📄"
                      label={`NEXT SESSION PROMPT — ${data.latestNSP?.path.split("/").pop()}`}
                    />
                    <div style={{ marginBottom: 10 }}>
                      <CopyBtn text={data.nspText} label="📋 העתק NSP" />
                    </div>
                    <CodeBlock text={data.nspText} />
                  </>
                )}
                {data.apText && (
                  <div style={{ marginTop: 24 }}>
                    <SectionTitle
                      icon="🔒"
                      label={`AI PROTOCOL — ${data.latestAP?.path.split("/").pop()}`}
                    />
                    <div style={{ marginBottom: 10 }}>
                      <CopyBtn text={data.apText} label="📋 העתק Protocol" />
                    </div>
                    <CodeBlock text={data.apText} />
                  </div>
                )}
                {!data.nspText && !data.apText && (
                  <div style={{ fontFamily: mono, fontSize: 12, color: C.amber }}>לא נמצאו קבצי NEXT_SESSION_PROMPT או AI_PROTOCOL בזיפ</div>
                )}
              </div>
            )}

            {/* ═══ CHANGELOG TAB ═══ */}
            {tab === "changelog" && (
              <div>
                {data.clText ? (
                  <>
                    <SectionTitle
                      icon="📝"
                      label={`CHANGELOG — ${data.latestCL?.path.split("/").pop()}`}
                    />
                    <div style={{ marginBottom: 10 }}>
                      <CopyBtn text={data.clText} label="📋 העתק Changelog" />
                    </div>
                    <CodeBlock text={data.clText} />
                  </>
                ) : (
                  <div style={{ fontFamily: mono, fontSize: 12, color: C.amber }}>לא נמצא CHANGELOG בזיפ</div>
                )}
                {data.claudeMd && (
                  <div style={{ marginTop: 24 }}>
                    <SectionTitle icon="🤖" label="CLAUDE.md" />
                    <div style={{ marginBottom: 10 }}>
                      <CopyBtn text={data.claudeMd} label="📋 העתק CLAUDE.md" />
                    </div>
                    <CodeBlock text={data.claudeMd} />
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
}

// ─── SPINNER ─────────────────────────────────────────────────────────────────
function Spinner({ large }) {
  const [f, setF] = useState(0);
  const frames = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
  useState(() => { const t = setInterval(() => setF(x => (x+1)%frames.length), 80); return () => clearInterval(t); });
  return <span style={{ fontFamily: mono, fontSize: large ? 32 : 14, color: C.green }}>{frames[f]}</span>;
}
