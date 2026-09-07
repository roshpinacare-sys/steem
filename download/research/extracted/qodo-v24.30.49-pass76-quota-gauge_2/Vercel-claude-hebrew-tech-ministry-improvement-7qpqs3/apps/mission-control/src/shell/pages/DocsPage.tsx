/**
 * DocsPage — the repository's real documentation, rendered on-device: the
 * README and CHANGELOG, every guide under docs/, and the ADRs. Relative
 * markdown links navigate inside the reader.
 */
import React, { useCallback, useEffect, useState } from "react";
import { UI, FONT, MONO, Panel, ScrollArea, EmptyState, SectionTitle, Button, Pill } from "../ui.js";
import { Icon } from "../icons.js";
import { ConnectHero } from "../ConnectSurface.js";
import { ghListContents, ghGetFile, type GhContentEntry } from "../github/client.js";
import { getGitHubConfig } from "../github/config.js";
import { decodeBase64Utf8, formatBytes } from "../github/encoding.js";
import { MarkdownView } from "../markdown.js";
import { consumeDocsIntent } from "../docsIntent.js";
import type { PageProps } from "../PlatformShell.js";

interface DocGroup { label: string; docs: GhContentEntry[] }

export function DocsPage(props: PageProps): React.ReactElement {
  const { mc, navigate } = props;
  if (mc.source === "none") {
    return <ScrollArea><ConnectHero mc={mc} navigate={navigate} /></ScrollArea>;
  }
  if (mc.source !== "github") {
    return (
      <ScrollArea>
        <Panel>
          <EmptyState icon="▤" title="Docs reads your real repository"
            hint="Connect GitHub in Connections to read the repository's guides and ADRs, rendered right here." />
          <div style={{ display: "flex", justifyContent: "center", paddingBottom: 12 }}>
            <Button variant="primary" onClick={() => navigate("connections")}><Icon name="connections" size={15} /> Open Connections</Button>
          </div>
        </Panel>
      </ScrollArea>
    );
  }
  return <DocsBody />;
}

function DocsBody(): React.ReactElement {
  const [groups, setGroups] = useState<DocGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<{ path: string; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const openDoc = useCallback(async (path: string) => {
    const c = getGitHubConfig();
    if (!c) return;
    setLoading(true);
    setError(null);
    try {
      const f = await ghGetFile(c, path);
      setDoc({ path, text: decodeBase64Utf8(f.content) });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : `failed to load ${path}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const c = getGitHubConfig();
    if (!c) return;
    (async () => {
      try {
        const md = (list: GhContentEntry[]) => list.filter((e) => e.type === "file" && /\.md$/i.test(e.name));
        const [root, docs, adr] = await Promise.all([
          ghListContents(c, "").catch(() => [] as GhContentEntry[]),
          ghListContents(c, "docs").catch(() => [] as GhContentEntry[]),
          ghListContents(c, "docs/adr").catch(() => [] as GhContentEntry[]),
        ]);
        const g: DocGroup[] = [];
        const rootDocs = md(root).filter((e) => /^(readme|changelog|contributing|license)/i.test(e.name) || /ROADMAP/i.test(e.name));
        if (rootDocs.length) g.push({ label: "Repository", docs: rootDocs });
        if (md(docs).length) g.push({ label: "Guides", docs: md(docs) });
        if (md(adr).length) g.push({ label: "Architecture decisions", docs: md(adr) });
        setGroups(g);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "failed to list docs");
        setGroups([]);
      }
    })();
    // Cross-page intent (Governance → policy guide).
    const intent = consumeDocsIntent();
    if (intent) void openDoc(intent);
  }, [openDoc]);

  if (doc) {
    const dir = doc.path.split("/").slice(0, -1).join("/");
    return (
      <ScrollArea>
        <button onClick={() => setDoc(null)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: UI.indigoLight, fontSize: 13, fontWeight: 600, padding: "0 0 12px", fontFamily: FONT }}>
          ‹ All docs
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <Pill color={UI.indigo}><span style={{ fontFamily: MONO, fontSize: 10.5 }}>{doc.path}</span></Pill>
        </div>
        <Panel pad={18}>
          <MarkdownView source={doc.text} baseDir={dir} onOpenDoc={(p) => void openDoc(p)} />
        </Panel>
      </ScrollArea>
    );
  }

  return (
    <ScrollArea>
      {error && <Panel pad={14} style={{ marginBottom: 12 }}><span style={{ color: UI.red, fontSize: 12.5 }}>{error}</span></Panel>}
      {loading && <div style={{ color: UI.textMuted, fontSize: 12.5, marginBottom: 10 }}>Loading…</div>}
      {groups == null ? (
        <Panel pad={14}><span style={{ color: UI.textMuted, fontSize: 12.5 }}>Indexing documentation…</span></Panel>
      ) : groups.length === 0 ? (
        <Panel><EmptyState icon="▤" title="No markdown docs found" hint="README.md, docs/, and docs/adr/ appear here when they exist." /></Panel>
      ) : (
        groups.map((g) => (
          <div key={g.label} style={{ marginBottom: 20 }}>
            <SectionTitle>{g.label}</SectionTitle>
            <Panel pad={6}>
              {g.docs.map((d) => (
                <button key={d.path} onClick={() => void openDoc(d.path)}
                  style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 44, padding: "8px 12px", background: "none", border: "none", borderBottom: `1px solid ${UI.border}`, cursor: "pointer", textAlign: "left", fontFamily: FONT }}>
                  <span style={{ color: UI.indigoLight, display: "grid", placeItems: "center", flexShrink: 0 }}><Icon name="docs" size={16} /></span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, color: UI.textPrimary, fontWeight: 600 }}>
                    {d.name.replace(/\.md$/i, "").replace(/[-_]/g, " ")}
                  </span>
                  <span style={{ fontSize: 11, color: UI.textMuted, flexShrink: 0 }}>{formatBytes(d.size)}</span>
                  <span style={{ color: UI.textMuted, fontSize: 13 }}>›</span>
                </button>
              ))}
            </Panel>
          </div>
        ))
      )}
    </ScrollArea>
  );
}
