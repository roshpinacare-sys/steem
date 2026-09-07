/**
 * FilesPage — the repository, in your hand. Browse real directories, view any
 * file (code highlighted, markdown rendered, images inline), download, edit
 * text in place, and upload from the device — every write is a REAL commit
 * through the Contents API on the selected branch.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { UI, FONT, MONO, Panel, ScrollArea, Button, Pill, EmptyState, SectionTitle } from "../ui.js";
import { Icon } from "../icons.js";
import { ConnectHero } from "../ConnectSurface.js";
import { useGitHubLive } from "../github/GitHubLiveContext.js";
import {
  ghListContents, ghGetFile, ghGetFileRaw, ghPutFile, ghDeleteFile, ghListBranches,
  type GhContentEntry, type GhFile, type GhBranch,
} from "../github/client.js";
import { getGitHubConfig } from "../github/config.js";
import { decodeBase64Utf8, encodeUtf8Base64, arrayBufferToBase64, looksLikeText, formatBytes } from "../github/encoding.js";
import { downloadBlob } from "../download.js";
import { MarkdownView } from "../markdown.js";
import { langForFile } from "../lang.js";
import type { PageProps } from "../PlatformShell.js";

const CodeViewLazy = React.lazy(() => import("../CodeView.js"));

const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i;
const MAX_VIEW = 400 * 1024;
const MAX_EDIT = 200 * 1024;

export function FilesPage(props: PageProps): React.ReactElement {
  const { mc, navigate } = props;
  if (mc.source === "none") {
    return <ScrollArea><ConnectHero mc={mc} navigate={navigate} /></ScrollArea>;
  }
  if (mc.source !== "github") {
    return (
      <ScrollArea>
        <Panel>
          <EmptyState icon="▤" title="Files reads your real repository"
            hint="Connect GitHub in Connections and this page becomes a full repository browser — view, edit, upload, and download real files." />
          <div style={{ display: "flex", justifyContent: "center", paddingBottom: 12 }}>
            <Button variant="primary" onClick={() => navigate("connections")}><Icon name="connections" size={15} /> Open Connections</Button>
          </div>
        </Panel>
      </ScrollArea>
    );
  }
  return <Browser />;
}

interface Notice { kind: "ok" | "err"; text: string }

function Browser(): React.ReactElement {
  const gh = useGitHubLive();
  const cfg = getGitHubConfig();
  const [ref, setRef] = useState<string>(cfg?.branch ?? "main");
  const [branches, setBranches] = useState<GhBranch[]>([]);
  const [path, setPath] = useState<string>("");
  const [entries, setEntries] = useState<GhContentEntry[] | null>(null);
  const [file, setFile] = useState<GhFile | null>(null);
  const [rawUrl, setRawUrl] = useState<string | null>(null); // blob URL for big images
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Editing state
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [commitMsg, setCommitMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Upload state
  const fileInput = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<{ name: string; base64: string; size: number; existingSha: string | null } | null>(null);
  const [uploadMsg, setUploadMsg] = useState("");

  useEffect(() => {
    const c = getGitHubConfig();
    if (!c) return;
    ghListBranches(c).then(setBranches).catch(() => {});
  }, []);

  const loadDir = useCallback(async (p: string, r: string) => {
    const c = getGitHubConfig();
    if (!c) return;
    setLoading(true);
    setError(null);
    setFile(null);
    setEditing(false);
    setConfirmDelete(false);
    if (rawUrl) { URL.revokeObjectURL(rawUrl); setRawUrl(null); }
    try {
      const list = await ghListContents(c, p, r);
      list.sort((a, b) => Number(b.type === "dir") - Number(a.type === "dir") || a.name.localeCompare(b.name));
      setEntries(list);
      setPath(p);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "failed to load directory");
    } finally {
      setLoading(false);
    }
  }, [rawUrl]);

  const openFile = useCallback(async (p: string) => {
    const c = getGitHubConfig();
    if (!c) return;
    setLoading(true);
    setError(null);
    setEditing(false);
    setConfirmDelete(false);
    if (rawUrl) { URL.revokeObjectURL(rawUrl); setRawUrl(null); }
    try {
      const f = await ghGetFile(c, p, ref);
      setFile(f);
      setPath(p);
      // Big image without inline content → fetch raw bytes for preview.
      if (IMG_EXT.test(f.name) && !f.content && f.size > 0 && f.size < 20 * 1024 * 1024) {
        const buf = await ghGetFileRaw(c, p, ref);
        setRawUrl(URL.createObjectURL(new Blob([buf])));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "failed to load file");
    } finally {
      setLoading(false);
    }
  }, [ref, rawUrl]);

  useEffect(() => { void loadDir("", ref); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const switchRef = (r: string) => { setRef(r); void loadDir("", r); };

  const crumbs = path ? path.split("/") : [];
  const dirOfFile = file ? crumbs.slice(0, -1).join("/") : path;

  // ── Actions ────────────────────────────────────────────────────────────────

  const startEdit = () => {
    if (!file) return;
    setDraft(decodeBase64Utf8(file.content));
    setCommitMsg(`Update ${file.name} via Mission Control`);
    setEditing(true);
  };

  const commitEdit = async () => {
    const c = getGitHubConfig();
    if (!c || !file) return;
    setBusy(true);
    try {
      await ghPutFile(c, file.path, encodeUtf8Base64(draft), commitMsg.trim() || `Update ${file.name}`, { sha: file.sha, branch: ref });
      setNotice({ kind: "ok", text: `Committed ${file.name} to ${ref}.` });
      setEditing(false);
      await openFile(file.path);
    } catch (e: unknown) {
      setNotice({ kind: "err", text: e instanceof Error ? e.message : "commit failed" });
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    const c = getGitHubConfig();
    if (!c || !file) return;
    setBusy(true);
    try {
      await ghDeleteFile(c, file.path, `Delete ${file.name} via Mission Control`, file.sha, ref);
      setNotice({ kind: "ok", text: `Deleted ${file.name} (committed to ${ref}).` });
      await loadDir(dirOfFile, ref);
    } catch (e: unknown) {
      setNotice({ kind: "err", text: e instanceof Error ? e.message : "delete failed" });
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const download = () => {
    if (!file) return;
    let blob: Blob;
    if (file.content) {
      const bin = atob(file.content);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new Blob([bytes]);
      if (!downloadBlob(file.name, blob)) setNotice({ kind: "err", text: "Download blocked here — use Open on GitHub." });
    } else {
      const c = getGitHubConfig();
      if (!c) return;
      setBusy(true);
      ghGetFileRaw(c, file.path, ref)
        .then((buf) => {
          if (!downloadBlob(file.name, new Blob([buf]))) setNotice({ kind: "err", text: "Download blocked here — use Open on GitHub." });
        })
        .catch((e: unknown) => setNotice({ kind: "err", text: e instanceof Error ? e.message : "download failed" }))
        .finally(() => setBusy(false));
    }
  };

  const onPickUpload = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    ev.target.value = "";
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = arrayBufferToBase64(reader.result as ArrayBuffer);
      const existing = entries?.find((e) => e.name === f.name && e.type === "file");
      setUpload({ name: f.name, base64, size: f.size, existingSha: existing?.sha ?? null });
      setUploadMsg(`${existing ? "Replace" : "Add"} ${f.name} via Mission Control`);
    };
    reader.readAsArrayBuffer(f);
  };

  const commitUpload = async () => {
    const c = getGitHubConfig();
    if (!c || !upload) return;
    setBusy(true);
    try {
      const target = path ? `${path}/${upload.name}` : upload.name;
      const existing = entries?.find((e) => e.name === upload.name && e.type === "file");
      await ghPutFile(c, target, upload.base64, uploadMsg.trim() || `Add ${upload.name}`, { sha: existing?.sha, branch: ref });
      setNotice({ kind: "ok", text: `Uploaded ${upload.name} → committed to ${ref}.` });
      setUpload(null);
      await loadDir(path, ref);
    } catch (e: unknown) {
      setNotice({ kind: "err", text: e instanceof Error ? e.message : "upload failed" });
    } finally {
      setBusy(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const repoLabel = gh.cfg ? `${gh.cfg.owner}/${gh.cfg.repo}` : "";

  return (
    <ScrollArea>
      {/* Toolbar: branch + upload */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <select value={ref} onChange={(e) => switchRef(e.target.value)} aria-label="Branch"
          style={{ fontFamily: MONO, fontSize: 12, padding: "8px 10px", borderRadius: 9, background: UI.bgElevated, border: `1px solid ${UI.borderStrong}`, color: UI.textPrimary, outline: "none", maxWidth: "55%" }}>
          {(branches.length ? branches : [{ name: ref, protected: false }]).map((b) => (
            <option key={b.name} value={b.name}>{b.name}</option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        {!file && (
          <>
            <input ref={fileInput} type="file" onChange={onPickUpload} style={{ display: "none" }} />
            <Button variant="primary" onClick={() => fileInput.current?.click()} disabled={busy}>
              <Icon name="upload" size={15} /> Upload
            </Button>
          </>
        )}
      </div>

      {/* Breadcrumbs */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, overflowX: "auto", whiteSpace: "nowrap", WebkitOverflowScrolling: "touch", paddingBottom: 8, marginBottom: 10, fontSize: 12.5 }}>
        <button onClick={() => void loadDir("", ref)} style={crumbBtn}>{repoLabel || "repo"}</button>
        {crumbs.map((seg, i) => {
          const isLast = i === crumbs.length - 1;
          const target = crumbs.slice(0, i + 1).join("/");
          return (
            <React.Fragment key={target}>
              <span style={{ color: UI.textMuted }}>/</span>
              {isLast ? (
                <span style={{ color: UI.textPrimary, fontWeight: 600, fontFamily: MONO, fontSize: 12 }}>{seg}</span>
              ) : (
                <button onClick={() => void loadDir(target, ref)} style={crumbBtn}>{seg}</button>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {notice && (
        <div role={notice.kind === "err" ? "alert" : undefined}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 13px", borderRadius: 10, marginBottom: 12, fontSize: 12.5,
            color: notice.kind === "err" ? UI.red : UI.green,
            background: notice.kind === "err" ? "rgba(248,113,113,0.08)" : "rgba(52,211,153,0.08)",
            border: `1px solid ${notice.kind === "err" ? "rgba(248,113,113,0.25)" : "rgba(52,211,153,0.25)"}` }}>
          <Icon name={notice.kind === "err" ? "alert" : "check"} size={14} />
          <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{notice.text}</span>
          <button onClick={() => setNotice(null)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 14 }}>×</button>
        </div>
      )}

      {error && <Panel pad={14} style={{ marginBottom: 12 }}><span style={{ color: UI.red, fontSize: 12.5 }}>{error}</span></Panel>}
      {loading && <div style={{ color: UI.textMuted, fontSize: 12.5, padding: "6px 0 12px" }}>Loading…</div>}

      {/* Upload commit sheet */}
      {upload && (
        <Panel pad={16} style={{ marginBottom: 14 }}>
          <SectionTitle>{upload.existingSha ? "Replace file" : "Upload file"}</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input value={upload.name} onChange={(e) => setUpload({ ...upload, name: e.target.value })} spellCheck={false}
                style={{ ...inputStyle, flex: 1, minWidth: 160, fontFamily: MONO }} />
              <Pill color={UI.textMuted}>{formatBytes(upload.size)}</Pill>
            </div>
            <input value={uploadMsg} onChange={(e) => setUploadMsg(e.target.value)} placeholder="Commit message" style={inputStyle} />
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Button variant="primary" color={UI.green} onClick={commitUpload} disabled={busy}>
                <Icon name="upload" size={14} /> {busy ? "Committing…" : upload.existingSha ? "Commit replacement" : "Commit upload"}
              </Button>
              <Button onClick={() => setUpload(null)} disabled={busy}>Cancel</Button>
              <span style={{ fontSize: 11.5, color: UI.textMuted }}>Commits to <span style={{ fontFamily: MONO }}>{ref}</span>{path ? <> in <span style={{ fontFamily: MONO }}>{path}/</span></> : null}</span>
            </div>
          </div>
        </Panel>
      )}

      {file ? <FileView file={file} rawUrl={rawUrl} busy={busy}
        editing={editing} draft={draft} setDraft={setDraft} commitMsg={commitMsg} setCommitMsg={setCommitMsg}
        confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete}
        onBack={() => void loadDir(dirOfFile, ref)} onEdit={startEdit} onCancelEdit={() => setEditing(false)}
        onCommit={commitEdit} onDelete={doDelete} onDownload={download} />
        : entries && (
          entries.length === 0
            ? <Panel><EmptyState icon="▤" title="Empty directory" hint="Upload a file here — it becomes a real commit." /></Panel>
            : (
              <Panel pad={6}>
                {entries.map((e) => (
                  <button key={e.path}
                    onClick={() => e.type === "dir" ? void loadDir(e.path, ref) : void openFile(e.path)}
                    style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 44, padding: "8px 12px", background: "none", border: "none", borderBottom: `1px solid ${UI.border}`, cursor: "pointer", textAlign: "left", fontFamily: FONT }}>
                    <span style={{ color: e.type === "dir" ? UI.amber : IMG_EXT.test(e.name) ? UI.purple : UI.textMuted, display: "grid", placeItems: "center", flexShrink: 0 }}>
                      <Icon name={e.type === "dir" ? "folder" : IMG_EXT.test(e.name) ? "image" : "file"} size={17} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: e.type === "dir" ? 13.5 : 12.5, color: UI.textPrimary, fontFamily: e.type === "dir" ? FONT : MONO, fontWeight: e.type === "dir" ? 600 : 400 }}>
                      {e.name}
                    </span>
                    {e.type === "file" && <span style={{ fontSize: 11.5, color: UI.textMuted, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{formatBytes(e.size)}</span>}
                    {e.type === "dir" && <span style={{ color: UI.textMuted, fontSize: 13 }}>›</span>}
                  </button>
                ))}
              </Panel>
            )
        )}
    </ScrollArea>
  );
}

const crumbBtn: React.CSSProperties = {
  background: "none", border: "none", padding: 0, cursor: "pointer",
  color: UI.indigoLight, fontSize: 12.5, fontWeight: 600, fontFamily: FONT,
};

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 9, fontFamily: FONT, fontSize: 13,
  background: UI.bgElevated, border: `1px solid ${UI.borderStrong}`, color: UI.textPrimary, outline: "none",
};

// ── File viewer ──────────────────────────────────────────────────────────────

function FileView(props: {
  file: GhFile; rawUrl: string | null; busy: boolean;
  editing: boolean; draft: string; setDraft: (s: string) => void;
  commitMsg: string; setCommitMsg: (s: string) => void;
  confirmDelete: boolean; setConfirmDelete: (b: boolean) => void;
  onBack: () => void; onEdit: () => void; onCancelEdit: () => void;
  onCommit: () => void; onDelete: () => void; onDownload: () => void;
}): React.ReactElement {
  const { file, rawUrl, busy, editing, draft, setDraft, commitMsg, setCommitMsg, confirmDelete, setConfirmDelete } = props;
  const [mdMode, setMdMode] = useState<"rendered" | "source">("rendered");

  const isImage = IMG_EXT.test(file.name);
  const isMd = /\.(md|markdown)$/i.test(file.name);
  const text = !isImage && file.content && file.size <= MAX_VIEW ? decodeBase64Utf8(file.content) : null;
  const isText = text != null && looksLikeText(text);

  return (
    <div>
      <button onClick={props.onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: UI.indigoLight, fontSize: 13, fontWeight: 600, padding: "0 0 12px", fontFamily: FONT }}>
        ‹ Back
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: UI.textWhite, fontFamily: MONO, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
        <Pill color={UI.textMuted}>{formatBytes(file.size)}</Pill>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <Button onClick={props.onDownload} disabled={busy}><Icon name="download" size={14} /> Download</Button>
        {isText && !editing && file.size <= MAX_EDIT && <Button color={UI.cyan} onClick={props.onEdit}><Icon name="file" size={14} /> Edit</Button>}
        <a href={file.htmlUrl} target="_blank" rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, fontFamily: FONT, color: UI.indigoLight, border: `1px solid ${UI.indigo}44`, textDecoration: "none" }}>
          <Icon name="external" size={14} /> Open on GitHub
        </a>
        {!confirmDelete
          ? <Button color={UI.red} onClick={() => setConfirmDelete(true)} disabled={busy}>Delete</Button>
          : (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <Button variant="primary" color={UI.red} onClick={props.onDelete} disabled={busy}>{busy ? "Deleting…" : "Confirm delete"}</Button>
              <Button onClick={() => setConfirmDelete(false)}>Keep</Button>
            </span>
          )}
      </div>

      {editing ? (
        <Panel pad={14}>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false}
            style={{ width: "100%", boxSizing: "border-box", minHeight: "48vh", resize: "vertical", border: `1px solid ${UI.borderStrong}`, borderRadius: 10, outline: "none", padding: "12px 14px", background: UI.bgElevated, color: UI.textPrimary, fontFamily: MONO, fontSize: 12.5, lineHeight: 1.6, tabSize: 2 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder="Commit message" style={{ ...inputStyle, flex: 1, minWidth: 180 }} />
            <Button variant="primary" color={UI.green} onClick={props.onCommit} disabled={busy}>{busy ? "Committing…" : "Commit"}</Button>
            <Button onClick={props.onCancelEdit} disabled={busy}>Cancel</Button>
          </div>
        </Panel>
      ) : isImage ? (
        <Panel pad={14} style={{ textAlign: "center" }}>
          {file.content
            ? <img src={`data:image/${file.name.split(".").pop()};base64,${file.content}`} alt={file.name} style={{ maxWidth: "100%", height: "auto", borderRadius: 8 }} />
            : rawUrl
              ? <img src={rawUrl} alt={file.name} style={{ maxWidth: "100%", height: "auto", borderRadius: 8 }} />
              : <div style={{ color: UI.textMuted, fontSize: 12.5, padding: 20 }}>Loading image…</div>}
        </Panel>
      ) : isMd && isText ? (
        <div>
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            {(["rendered", "source"] as const).map((m) => (
              <button key={m} onClick={() => setMdMode(m)}
                style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid transparent", cursor: "pointer", fontFamily: FONT, fontSize: 12.5, fontWeight: 600, textTransform: "capitalize", color: mdMode === m ? UI.textWhite : UI.textMuted, background: mdMode === m ? UI.bgActive : "transparent" }}>
                {m}
              </button>
            ))}
          </div>
          {mdMode === "rendered"
            ? <Panel pad={18}><MarkdownView source={text!} baseDir={file.path.split("/").slice(0, -1).join("/")} /></Panel>
            : <Panel pad={0}><CodeBlock code={text!} name={file.name} /></Panel>}
        </div>
      ) : isText ? (
        <Panel pad={0}><CodeBlock code={text!} name={file.name} /></Panel>
      ) : (
        <Panel>
          <EmptyState icon="◆" title={`Binary file · ${formatBytes(file.size)}`}
            hint="Preview isn't available for this type — download it or open it on GitHub." />
        </Panel>
      )}
    </div>
  );
}

function CodeBlock({ code, name }: { code: string; name: string }): React.ReactElement {
  return (
    <React.Suspense fallback={<pre style={{ margin: 0, padding: "12px 14px", fontFamily: MONO, fontSize: 12, lineHeight: 1.6, overflowX: "auto", color: UI.textSecondary }}>{code}</pre>}>
      <CodeViewLazy code={code} language={langForFile(name)} />
    </React.Suspense>
  );
}
