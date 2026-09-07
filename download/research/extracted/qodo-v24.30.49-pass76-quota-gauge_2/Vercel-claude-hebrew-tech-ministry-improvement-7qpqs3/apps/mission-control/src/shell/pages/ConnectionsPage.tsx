/**
 * ConnectionsPage — verify every connection and integration at a glance. The
 * top block runs live checks the browser can actually perform (data source,
 * proxy health, session auth, resume queue, in-browser runtime). The catalog
 * below is the agent's full integration surface, configured operator-side.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useTelemetryCtx } from "../../context/TelemetryContext.js";
import { fetchWithTimeout } from "../../utils/fetch-timeout.js";
import { getSessionToken } from "../../utils/session.js";
import { UI, Panel, ScrollArea, SectionTitle, Dot, Pill, CardGrid, MONO } from "../ui.js";
import { GitHubConnectCard } from "../ConnectSurface.js";
import { getGitHubConfig } from "../github/config.js";
import { ghVerify } from "../github/client.js";
import { configuredProviders, getSelected } from "../llm/store.js";
import { providerById } from "../llm/providers.js";
import type { PageProps } from "../PlatformShell.js";

type Health = "ok" | "warn" | "down" | "checking" | "na";
interface Check { name: string; state: Health; detail: string }

const HC: Record<Health, string> = { ok: UI.green, warn: UI.amber, down: UI.red, checking: UI.textMuted, na: UI.textMuted };

export function ConnectionsPage({ mc }: PageProps): React.ReactElement {
  const { error, lastSyncAt } = useTelemetryCtx();
  const [checks, setChecks] = useState<Check[]>([]);

  const runChecks = useCallback(async () => {
    const out: Check[] = [];
    // 1. Data source — name the real source, never a euphemism.
    out.push(mc.source === "simulator"
      ? { name: "Data source", state: "warn", detail: "Simulator — labeled sandbox, not your real operations" }
      : mc.source === "github"
        ? { name: "Data source", state: "ok", detail: `Live — GitHub · ${mc.githubRepo}` }
        : mc.source === "proxy"
          ? (error ? { name: "Data source", state: "down", detail: `Live — ${error}` }
            : lastSyncAt ? { name: "Data source", state: "ok", detail: "Live — telemetry syncing" }
            : { name: "Data source", state: "warn", detail: "Live — connecting" })
          : { name: "Data source", state: "warn", detail: "not connected — connect GitHub below" });

    // 2. GitHub Live
    const ghCfg = getGitHubConfig();
    if (ghCfg) {
      try {
        const v = await ghVerify(ghCfg);
        out.push({ name: "GitHub (Live)", state: "ok", detail: `${v.repoFullName} · ${v.login}${v.canDispatch ? " · can dispatch" : " · read-only token"}` });
      } catch (e: unknown) {
        out.push({ name: "GitHub (Live)", state: "down", detail: e instanceof Error ? e.message : "unreachable" });
      }
    } else {
      out.push({ name: "GitHub (Live)", state: "na", detail: "not connected — paste a token below" });
    }

    // 3. AI providers (device-local keys → chat freeform mode)
    const providers = configuredProviders();
    if (providers.length > 0) {
      const sel = getSelected();
      const selLabel = sel ? providerById(sel)?.label : null;
      out.push({ name: "AI providers", state: "ok", detail: `${providers.length} connected — default ${selLabel ?? "?"}` });
    } else {
      out.push({ name: "AI providers", state: "na", detail: "none — add your LLM key in Settings for freeform chat" });
    }

    // 4. In-browser runtime (Studio)
    const iso = typeof window !== "undefined" && window.crossOriginIsolated;
    out.push({ name: "Studio runtime", state: "ok", detail: iso ? "Cross-origin isolated — full Node runtime" : "Local runtime — real in-app execution (WebView-safe)" });

    setChecks([...out, ...(mc.proxyUrl ? [{ name: "Telemetry proxy", state: "checking" as Health, detail: "…" }, { name: "Session auth", state: "checking" as Health, detail: "…" }, { name: "Resume queue", state: "checking" as Health, detail: "…" }] : [
      { name: "Telemetry proxy", state: "na" as Health, detail: "optional — deep agent telemetry; add in Settings" },
    ])]);

    if (!mc.proxyUrl) return;

    // 3. Proxy /health (unauthenticated)
    const live: Check[] = [...out];
    try {
      const t0 = Date.now();
      const r = await fetchWithTimeout(`${mc.proxyUrl}/health`, {}, 10_000);
      live.push({ name: "Telemetry proxy", state: r.ok ? "ok" : "down", detail: r.ok ? `reachable · ${Date.now() - t0}ms` : `HTTP ${r.status}` });
    } catch (e: unknown) {
      live.push({ name: "Telemetry proxy", state: "down", detail: e instanceof Error ? e.message : "unreachable" });
    }
    // 4. Session auth
    try {
      await getSessionToken(mc.proxyUrl);
      live.push({ name: "Session auth", state: "ok", detail: "authenticated — short-lived token issued" });
    } catch (e: unknown) {
      live.push({ name: "Session auth", state: "warn", detail: e instanceof Error ? e.message : "not authenticated" });
    }
    // 5. Resume queue
    try {
      const token = await getSessionToken(mc.proxyUrl).catch(() => "");
      const r = await fetchWithTimeout(`${mc.proxyUrl}/trigger-queue/health`, { headers: token ? { "X-Qodo-Session": token } : {} }, 10_000);
      if (r.ok) {
        const d = (await r.json()) as { queued?: number; processing?: number; dead?: number };
        live.push({ name: "Resume queue", state: (d.dead ?? 0) > 0 ? "warn" : "ok", detail: `queued ${d.queued ?? 0} · processing ${d.processing ?? 0} · dead ${d.dead ?? 0}` });
      } else {
        live.push({ name: "Resume queue", state: "warn", detail: `HTTP ${r.status}` });
      }
    } catch (e: unknown) {
      live.push({ name: "Resume queue", state: "warn", detail: e instanceof Error ? e.message : "unreachable" });
    }
    setChecks(live);
  }, [mc.source, mc.githubRepo, mc.proxyUrl, error, lastSyncAt]);

  useEffect(() => { void runChecks(); }, [runChecks]);

  const okCount = checks.filter((c) => c.state === "ok").length;

  return (
    <ScrollArea>
      <SectionTitle right={<button onClick={runChecks} style={{ background: "none", border: "none", color: UI.indigoLight, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>recheck</button>}>
        Live checks · {okCount}/{checks.length} healthy
      </SectionTitle>
      <Panel pad={6} style={{ marginBottom: 24 }}>
        {checks.map((c) => (
          <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 12px", borderBottom: `1px solid ${UI.border}` }}>
            <Dot color={HC[c.state]} glow={c.state === "ok"} />
            <span style={{ flex: "0 1 150px", minWidth: 84, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13.5, fontWeight: 600, color: UI.textPrimary }}>{c.name}</span>
            <span style={{ flex: 1, fontSize: 12.5, color: UI.textMuted, fontFamily: c.detail.includes("ms") || c.detail.includes("queued") ? MONO : undefined }}>{c.detail}</span>
            <Pill color={HC[c.state]}>{c.state === "na" ? "n/a" : c.state}</Pill>
          </div>
        ))}
      </Panel>

      <SectionTitle>GitHub · Live connection</SectionTitle>
      <div style={{ fontSize: 12.5, color: UI.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
        One token connects the whole console to your real repository — live workflow runs with job-by-job detail, commits, pull requests, and real task dispatch through the agent pipeline.
      </div>
      <div style={{ marginBottom: 24 }}>
        <GitHubConnectCard onConnected={() => void runChecks()} />
      </div>

      <SectionTitle>Integration catalog</SectionTitle>
      <div style={{ fontSize: 12.5, color: UI.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
        The agent's optional integrations. These are configured operator-side (repo secrets / env) and activate automatically when their credentials are present — the pipeline logs each one's status at startup.
      </div>
      {GROUPS.map((grp) => (
        <div key={grp.label} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700, color: UI.textMuted, marginBottom: 8 }}>{grp.label}</div>
          <CardGrid min={220}>
            {grp.items.map((it) => (
              <Panel key={it.name} pad={14} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{it.name}</span>
                  <Pill color={it.required ? UI.indigo : UI.textMuted}>{it.required ? "required" : "optional"}</Pill>
                </div>
                <span style={{ fontSize: 12, color: UI.textMuted, lineHeight: 1.45 }}>{it.blurb}</span>
                <code style={{ fontFamily: MONO, fontSize: 10.5, color: UI.textMuted }}>{it.env}</code>
              </Panel>
            ))}
          </CardGrid>
        </div>
      ))}
    </ScrollArea>
  );
}

const GROUPS: { label: string; items: { name: string; blurb: string; env: string; required?: boolean }[] }[] = [
  { label: "Core", items: [
    { name: "GitHub", blurb: "Reads the repo, commits, opens and merges PRs.", env: "GITHUB_TOKEN", required: true },
    { name: "Upstash Redis", blurb: "Checkpoints, locks, trust ledger, resume queue.", env: "UPSTASH_REDIS_REST_URL/TOKEN", required: true },
    { name: "LLM providers", blurb: "Groq, Gemini, Cerebras, and more — racing router.", env: "GROQ_API_KEY · … (any one)", required: true },
  ] },
  { label: "Delivery", items: [
    { name: "Vercel", blurb: "Canary preview deploys and production promotion.", env: "VERCEL_TOKEN" },
    { name: "Cloudflare R2", blurb: "Semantic cache, hive, and skill-vector storage.", env: "R2_ACCOUNT_ID · R2_BUCKET" },
    { name: "Upstash Vector", blurb: "Cross-run skill exchange and pattern recall.", env: "UPSTASH_VECTOR_REST_URL" },
  ] },
  { label: "Signals & notifications", items: [
    { name: "Slack", blurb: "Gate decisions and run notifications.", env: "SLACK_WEBHOOK_URL" },
    { name: "Sentry", blurb: "Error-gate: block merges that would raise new issues.", env: "SENTRY_AUTH_TOKEN · ORG · PROJECT" },
    { name: "Codecov", blurb: "Coverage intelligence in the validation gate.", env: "CODECOV_TOKEN" },
  ] },
  { label: "Issue sources", items: [
    { name: "Linear", blurb: "Enriches objectives from linked Linear tickets.", env: "LINEAR_API_KEY" },
    { name: "Jira", blurb: "Enriches objectives from linked Jira issues.", env: "JIRA_BASE_URL · JIRA_TOKEN" },
    { name: "QStash", blurb: "Async job scheduling for long-running work.", env: "QSTASH_TOKEN" },
  ] },
];
