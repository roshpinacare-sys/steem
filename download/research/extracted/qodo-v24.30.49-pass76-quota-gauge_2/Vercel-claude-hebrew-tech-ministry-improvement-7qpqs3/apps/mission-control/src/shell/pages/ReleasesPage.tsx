/**
 * ReleasesPage — every shippable thing the repository produces: the CI-built
 * Android APK first (that's the product in your hand), then all workflow
 * artifacts, then GitHub releases with their assets. Downloads are real
 * authenticated fetches; when the signed artifact host blocks a browser
 * fetch, the button falls back to opening the run on GitHub.
 */
import React, { useCallback, useEffect, useState } from "react";
import { UI, FONT, MONO, Panel, ScrollArea, Button, Pill, EmptyState, SectionTitle, timeAgo, Dot } from "../ui.js";
import { Icon } from "../icons.js";
import { ConnectHero } from "../ConnectSurface.js";
import { useGitHubLive } from "../github/GitHubLiveContext.js";
import { ghListReleases, ghListArtifacts, ghDownloadArtifactZip, type GhRelease, type GhArtifact } from "../github/client.js";
import { getGitHubConfig } from "../github/config.js";
import { formatBytes } from "../github/encoding.js";
import { downloadBlob } from "../download.js";
import { MarkdownView } from "../markdown.js";
import type { PageProps } from "../PlatformShell.js";

const APK_ARTIFACT = "qodo-mission-control-apk";

export function ReleasesPage(props: PageProps): React.ReactElement {
  const { mc, navigate } = props;
  if (mc.source === "none") {
    return <ScrollArea><ConnectHero mc={mc} navigate={navigate} /></ScrollArea>;
  }
  if (mc.source !== "github") {
    return (
      <ScrollArea>
        <Panel>
          <EmptyState icon="◈" title="Releases reads your real repository"
            hint="Connect GitHub in Connections to browse releases and download CI artifacts — including the Android APK — right from here." />
          <div style={{ display: "flex", justifyContent: "center", paddingBottom: 12 }}>
            <Button variant="primary" onClick={() => navigate("connections")}><Icon name="connections" size={15} /> Open Connections</Button>
          </div>
        </Panel>
      </ScrollArea>
    );
  }
  return <ReleasesBody />;
}

function ReleasesBody(): React.ReactElement {
  const gh = useGitHubLive();
  const [releases, setReleases] = useState<GhRelease[] | null>(null);
  const [artifacts, setArtifacts] = useState<GhArtifact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [fallback, setFallback] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    const c = getGitHubConfig();
    if (!c) return;
    setError(null);
    try {
      const [rel, art] = await Promise.all([ghListReleases(c), ghListArtifacts(c)]);
      setReleases(rel.filter((r) => !r.draft));
      setArtifacts(art);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "failed to load releases");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const downloadArtifact = async (a: GhArtifact) => {
    const c = getGitHubConfig();
    if (!c) return;
    setDownloading(a.id);
    try {
      const blob = await ghDownloadArtifactZip(c, a.id);
      if (!downloadBlob(`${a.name}.zip`, blob)) throw new Error("save blocked");
    } catch {
      setFallback((prev) => new Set(prev).add(a.id));
    } finally {
      setDownloading(null);
    }
  };

  const repo = gh.cfg ? `${gh.cfg.owner}/${gh.cfg.repo}` : "";
  const runUrl = (a: GhArtifact) => a.workflowRunId
    ? `https://github.com/${repo}/actions/runs/${a.workflowRunId}`
    : `https://github.com/${repo}/actions`;

  const apkBuilds = (artifacts ?? []).filter((a) => a.name === APK_ARTIFACT).slice(0, 3);
  const others = (artifacts ?? []).filter((a) => a.name !== APK_ARTIFACT).slice(0, 20);

  const ArtifactActions = ({ a }: { a: GhArtifact }) => (
    fallback.has(a.id) ? (
      <a href={runUrl(a)} target="_blank" rel="noopener noreferrer" style={linkBtn}>
        <Icon name="external" size={13} /> Open run on GitHub
      </a>
    ) : (
      <Button onClick={() => void downloadArtifact(a)} disabled={a.expired || downloading === a.id}>
        <Icon name="download" size={13} /> {downloading === a.id ? "Fetching…" : "Download"}
      </Button>
    )
  );

  return (
    <ScrollArea>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <Dot color={error ? UI.red : UI.green} glow={!error} size={7} />
        <span style={{ fontSize: 12, color: UI.textSecondary, fontFamily: MONO }}>{repo}</span>
        <span style={{ fontSize: 11.5, color: error ? UI.red : UI.textMuted, flex: 1, minWidth: 120 }}>{error ?? "real artifacts & releases"}</span>
        <button onClick={() => void load()} style={{ background: "none", border: "none", color: UI.indigoLight, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: FONT, padding: 0 }}>refresh</button>
      </div>

      {/* App builds — the APK, front and center */}
      <SectionTitle>App builds · Android APK</SectionTitle>
      {artifacts == null ? (
        <Panel pad={14} style={{ marginBottom: 20 }}><span style={{ color: UI.textMuted, fontSize: 12.5 }}>Loading artifacts…</span></Panel>
      ) : apkBuilds.length === 0 ? (
        <Panel style={{ marginBottom: 20 }}><EmptyState icon="◈" title="No APK builds in view" hint="Every push builds a fresh APK in CI — the newest artifacts appear here." /></Panel>
      ) : (
        <div style={{ marginBottom: 20 }}>
          {apkBuilds.map((a, i) => (
            <Panel key={a.id} pad={16} style={{ marginBottom: 10, borderColor: i === 0 ? "rgba(99,102,241,0.35)" : undefined }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: UI.textWhite }}>Mission Control APK</span>
                {i === 0 && <Pill color={UI.indigo}>latest</Pill>}
                {a.expired && <Pill color={UI.red}>expired</Pill>}
              </div>
              <div style={{ fontSize: 12, color: UI.textMuted, marginBottom: 12, fontFamily: MONO }}>
                {formatBytes(a.sizeInBytes)} · built {timeAgo(a.createdAt)}{a.expiresAt && !a.expired ? ` · expires ${new Date(a.expiresAt).toLocaleDateString()}` : ""}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <ArtifactActions a={a} />
                <a href={runUrl(a)} target="_blank" rel="noopener noreferrer" style={linkBtn}>
                  <Icon name="external" size={13} /> Producing run
                </a>
              </div>
            </Panel>
          ))}
        </div>
      )}

      {/* All artifacts */}
      {others.length > 0 && (
        <>
          <SectionTitle>All artifacts</SectionTitle>
          <Panel pad={6} style={{ marginBottom: 20 }}>
            {others.map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: `1px solid ${UI.border}`, flexWrap: "wrap" }}>
                <span style={{ flex: "1 1 140px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, fontFamily: MONO, color: UI.textPrimary }}>{a.name}</span>
                <span style={{ fontSize: 11.5, color: UI.textMuted, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{formatBytes(a.sizeInBytes)} · {timeAgo(a.createdAt)}</span>
                <ArtifactActions a={a} />
              </div>
            ))}
          </Panel>
        </>
      )}

      {/* Releases */}
      <SectionTitle>Releases</SectionTitle>
      {releases == null ? (
        <Panel pad={14}><span style={{ color: UI.textMuted, fontSize: 12.5 }}>Loading releases…</span></Panel>
      ) : releases.length === 0 ? (
        <Panel><EmptyState icon="◇" title="No releases yet" hint="Tags published from CI appear here with their notes and downloadable assets." /></Panel>
      ) : (
        releases.map((r) => <ReleaseCard key={r.id} r={r} />)
      )}
    </ScrollArea>
  );
}

function ReleaseCard({ r }: { r: GhRelease }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const preview = r.body.split("\n").slice(0, expanded ? undefined : 4).join("\n");
  const truncated = !expanded && r.body.split("\n").length > 4;
  return (
    <Panel pad={16} style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <Pill color={r.prerelease ? UI.amber : UI.indigo}>{r.tagName}</Pill>
        <span style={{ fontSize: 14, fontWeight: 700, color: UI.textWhite, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
        {r.prerelease && <Pill color={UI.amber}>pre-release</Pill>}
        <span style={{ fontSize: 11.5, color: UI.textMuted, marginLeft: "auto" }}>{r.publishedAt ? timeAgo(r.publishedAt) : "unpublished"}</span>
      </div>
      {r.body && (
        <div style={{ marginBottom: 8 }}>
          <MarkdownView source={preview} />
          {truncated && (
            <button onClick={() => setExpanded(true)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: UI.indigoLight, fontSize: 12.5, fontWeight: 600, fontFamily: FONT }}>
              Read more ›
            </button>
          )}
        </div>
      )}
      {r.assets.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {r.assets.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 140px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, fontFamily: MONO, color: UI.textSecondary }}>{a.name}</span>
              <span style={{ fontSize: 11.5, color: UI.textMuted }}>{formatBytes(a.size)} · {a.downloadCount} downloads</span>
              <a href={a.browserDownloadUrl} target="_blank" rel="noopener noreferrer" style={linkBtn}>
                <Icon name="download" size={13} /> Download
              </a>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 8 }}>
        <a href={r.htmlUrl} target="_blank" rel="noopener noreferrer" style={{ ...linkBtn, border: "none", padding: 0 }}>
          <Icon name="external" size={12} /> View on GitHub
        </a>
      </div>
    </Panel>
  );
}

const linkBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 9,
  fontSize: 12.5, fontWeight: 600, fontFamily: FONT, color: UI.indigoLight,
  border: `1px solid ${UI.indigo}44`, textDecoration: "none",
};
