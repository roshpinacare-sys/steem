/**
 * StudioPage — a real in-browser development environment. Create and write
 * files, install dependencies, run a dev server, preview it live, and build —
 * all inside a WebContainer (a Node.js runtime in the browser). No backend.
 *
 * This is the app's "operationally complete" surface: create · write · run ·
 * install · launch · preview · build, in one place.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { UI, FONT, MONO, Pill, Button, Dot, EmptyState } from "../ui.js";
import { Icon } from "../icons.js";
import { useWebContainer } from "../studio/useWebContainer.js";
import { STATIC_TEMPLATE } from "../studio/templates.js";
import { LocalStudio } from "../studio/LocalStudio.js";
import type { PageProps } from "../PlatformShell.js";

type RightTab = "terminal" | "preview";

export function StudioPage({ isMobile }: PageProps): React.ReactElement {
  // No cross-origin isolation (Android WebView, plain hosting) → WebContainer
  // can never boot. Run the on-device local runtime instead of a dead screen.
  if (typeof window !== "undefined" && !window.crossOriginIsolated) {
    return <LocalStudio isMobile={isMobile} />;
  }
  return <WebContainerStudio isMobile={isMobile} />;
}

function WebContainerStudio({ isMobile }: { isMobile: boolean }): React.ReactElement {
  const wc = useWebContainer();
  const [active, setActive] = useState<string>(STATIC_TEMPLATE.entry);
  const [editor, setEditor] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [right, setRight] = useState<RightTab>("terminal");
  const [cmd, setCmd] = useState("");
  const [newName, setNewName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const booted = useRef(false);

  // Boot once with the starter template and open the entry file.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void wc.boot(STATIC_TEMPLATE.tree).then(async () => {
      const c = await wc.readFile(STATIC_TEMPLATE.entry);
      setEditor(c);
    });
  }, [wc]);

  const openFile = useCallback(async (path: string) => {
    const c = await wc.readFile(path);
    setActive(path);
    setEditor(c);
    setDirty(false);
  }, [wc]);

  const save = useCallback(async () => {
    await wc.writeFile(active, editor);
    setDirty(false);
  }, [wc, active, editor]);

  // Auto-save shortly after typing stops so Dev/Build see fresh files.
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => { void save(); }, 700);
    return () => clearTimeout(t);
  }, [editor, dirty, save]);

  const terminalRef = useRef<HTMLDivElement>(null);
  useEffect(() => { terminalRef.current?.scrollTo({ top: 1e9 }); }, [wc.lines]);
  useEffect(() => { if (wc.previewUrl) setRight("preview"); }, [wc.previewUrl]);

  const ready = wc.bootState === "ready";
  const running = wc.procState === "running";

  const createFile = async () => {
    const name = newName.trim();
    if (!name) return;
    await wc.writeFile(name, "");
    setShowNew(false);
    setNewName("");
    await openFile(name);
  };

  // Isolation exists but the runtime can't boot (blocked CDN, boot error):
  // fall back to the on-device local runtime so Studio always works.
  if (wc.bootState === "unsupported" || wc.bootState === "error") {
    return <LocalStudio isMobile={isMobile} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Action bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 20px", borderBottom: `1px solid ${UI.border}`, flexWrap: "wrap" }}>
        <Pill color={ready ? UI.green : wc.bootState === "booting" ? UI.amber : UI.textMuted}>
          <Dot color={ready ? UI.green : wc.bootState === "booting" ? UI.amber : UI.textMuted} glow={ready} size={7} />
          {ready ? "Runtime ready" : wc.bootState === "booting" ? "Booting…" : "Idle"}
        </Pill>
        <span style={{ fontSize: 12.5, color: UI.textMuted }}>{STATIC_TEMPLATE.name}</span>
        <div style={{ flex: 1 }} />
        <Button color={UI.cyan} onClick={() => wc.run("npm", ["install"])} disabled={!ready || running}><Icon name="bolt" size={14} /> Install</Button>
        <Button variant="primary" color={UI.green} onClick={() => wc.run("npm", ["run", "dev"])} disabled={!ready || running}><Icon name="dispatch" size={14} /> Dev</Button>
        <Button color={UI.purple} onClick={() => wc.run("npm", ["run", "build"])} disabled={!ready || running}><Icon name="pipeline" size={14} /> Build</Button>
        <Button color={UI.red} onClick={wc.stop} disabled={!running}>Stop</Button>
      </div>

      {isMobile ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* File select */}
          <div style={{ display: "flex", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${UI.border}`, alignItems: "center" }}>
            <select value={active} onChange={(e) => openFile(e.target.value)}
              style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: 12.5, padding: "8px 10px", borderRadius: 8, background: UI.bgElevated, border: `1px solid ${UI.borderStrong}`, color: UI.textPrimary, outline: "none" }}>
              {wc.files.filter((f) => !f.dir).map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}
            </select>
            <button onClick={save} disabled={!dirty} style={{ background: "none", border: "none", cursor: dirty ? "pointer" : "default", color: dirty ? UI.indigoLight : UI.textMuted, fontSize: 13, fontWeight: 600, fontFamily: FONT }}>Save</button>
          </div>
          {/* Editor (top half) */}
          <textarea value={editor} onChange={(e) => { setEditor(e.target.value); setDirty(true); }} spellCheck={false}
            style={{ flex: 1, minHeight: 0, resize: "none", border: "none", outline: "none", padding: "12px 14px", background: "transparent", color: UI.textPrimary, fontFamily: MONO, fontSize: 12.5, lineHeight: 1.6, borderBottom: `1px solid ${UI.border}` }} />
          {/* Console (bottom half) */}
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", gap: 4, padding: "7px 12px", borderBottom: `1px solid ${UI.border}` }}>
              {(["terminal", "preview"] as const).map((t) => (
                <button key={t} onClick={() => setRight(t)} style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid transparent", cursor: "pointer", fontFamily: FONT, fontSize: 12.5, fontWeight: 600, textTransform: "capitalize", color: right === t ? UI.textWhite : UI.textMuted, background: right === t ? UI.bgActive : "transparent" }}>
                  {t}{t === "preview" && wc.previewUrl ? " ●" : ""}
                </button>
              ))}
            </div>
            {right === "terminal" ? (
              <div ref={terminalRef} style={{ flex: 1, overflowY: "auto", padding: "10px 14px", fontFamily: MONO, fontSize: 12, lineHeight: 1.55 }}>
                {wc.lines.map((l) => <div key={l.id} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: l.kind === "cmd" ? UI.green : l.kind === "sys" ? UI.textMuted : UI.textSecondary }}>{l.text}</div>)}
              </div>
            ) : wc.previewUrl ? (
              <iframe title="preview" src={wc.previewUrl} style={{ flex: 1, border: "none", background: "#fff" }} />
            ) : (
              <EmptyState icon="◲" title="No preview yet" hint="Tap Dev to start the server." />
            )}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "190px minmax(0, 1fr) minmax(0, 1fr)", minHeight: 0 }}>
          {/* File tree */}
          <div style={{ borderRight: `1px solid ${UI.border}`, overflowY: "auto", padding: "10px 8px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 8px 8px" }}>
              <span style={{ fontSize: 10.5, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700, color: UI.textMuted }}>Files</span>
              <button title="New file" onClick={() => setShowNew((v) => !v)} style={{ background: "none", border: "none", color: UI.indigoLight, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>＋</button>
            </div>
            {showNew && (
              <div style={{ padding: "0 4px 8px", display: "flex", gap: 4 }}>
                <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createFile()}
                  placeholder="src/new.js" spellCheck={false}
                  style={{ flex: 1, minWidth: 0, fontSize: 12, fontFamily: MONO, padding: "5px 7px", borderRadius: 7, background: UI.bgElevated, border: `1px solid ${UI.borderStrong}`, color: UI.textPrimary, outline: "none" }} />
              </div>
            )}
            {wc.files.filter((f) => !f.dir).map((f) => (
              <button key={f.path} onClick={() => openFile(f.path)}
                style={{
                  display: "block", width: "100%", textAlign: "left", padding: "5px 8px", borderRadius: 7, marginBottom: 1,
                  fontFamily: MONO, fontSize: 12, cursor: "pointer", border: "1px solid transparent",
                  color: active === f.path ? UI.textWhite : UI.textSecondary,
                  background: active === f.path ? UI.bgActive : "transparent",
                }}>
                {f.path}
              </button>
            ))}
          </div>

          {/* Editor */}
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, borderRight: `1px solid ${UI.border}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", borderBottom: `1px solid ${UI.border}` }}>
              <span style={{ fontFamily: MONO, fontSize: 12, color: UI.textSecondary }}>{active}{dirty ? " •" : ""}</span>
              <button onClick={save} disabled={!dirty} style={{ background: "none", border: "none", cursor: dirty ? "pointer" : "default", color: dirty ? UI.indigoLight : UI.textMuted, fontSize: 12, fontWeight: 600, fontFamily: FONT }}>Save ⌘S</button>
            </div>
            <textarea
              value={editor}
              onChange={(e) => { setEditor(e.target.value); setDirty(true); }}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); } }}
              spellCheck={false}
              style={{
                flex: 1, resize: "none", border: "none", outline: "none", padding: "12px 14px",
                background: "transparent", color: UI.textPrimary, fontFamily: MONO, fontSize: 12.5, lineHeight: 1.6, tabSize: 2,
              }}
            />
          </div>

          {/* Right: terminal / preview */}
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ display: "flex", gap: 4, padding: "8px 12px", borderBottom: `1px solid ${UI.border}` }}>
              {(["terminal", "preview"] as const).map((t) => (
                <button key={t} onClick={() => setRight(t)} style={{
                  padding: "5px 12px", borderRadius: 7, border: "1px solid transparent", cursor: "pointer", fontFamily: FONT, fontSize: 12.5, fontWeight: 600, textTransform: "capitalize",
                  color: right === t ? UI.textWhite : UI.textMuted, background: right === t ? UI.bgActive : "transparent",
                }}>
                  {t}{t === "preview" && wc.previewUrl ? " ●" : ""}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              {right === "terminal" && <button onClick={wc.clearTerminal} style={{ background: "none", border: "none", color: UI.textMuted, cursor: "pointer", fontSize: 11.5 }}>clear</button>}
              {right === "preview" && wc.previewUrl && <a href={wc.previewUrl} target="_blank" rel="noreferrer" style={{ color: UI.indigoLight, fontSize: 11.5, textDecoration: "none" }}>open ↗</a>}
            </div>

            {right === "terminal" ? (
              <>
                <div ref={terminalRef} style={{ flex: 1, overflowY: "auto", padding: "10px 14px", fontFamily: MONO, fontSize: 12, lineHeight: 1.55 }}>
                  {wc.lines.map((l) => (
                    <div key={l.id} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: l.kind === "cmd" ? UI.green : l.kind === "sys" ? UI.textMuted : UI.textSecondary }}>
                      {l.text}
                    </div>
                  ))}
                </div>
                <form onSubmit={(e) => { e.preventDefault(); const parts = cmd.trim().split(/\s+/); if (parts[0]) { void wc.run(parts[0], parts.slice(1)); setCmd(""); } }}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderTop: `1px solid ${UI.border}` }}>
                  <span style={{ color: UI.green, fontFamily: MONO, fontSize: 13 }}>$</span>
                  <input value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder={running ? "process running…" : "npm run build"} disabled={!ready || running} spellCheck={false}
                    style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: UI.textPrimary, fontFamily: MONO, fontSize: 12.5 }} />
                </form>
              </>
            ) : wc.previewUrl ? (
              <iframe title="preview" src={wc.previewUrl} style={{ flex: 1, border: "none", background: "#fff" }} />
            ) : (
              <EmptyState icon="◲" title="No preview yet" hint="Press Dev to start the server — the live preview opens here automatically." />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
