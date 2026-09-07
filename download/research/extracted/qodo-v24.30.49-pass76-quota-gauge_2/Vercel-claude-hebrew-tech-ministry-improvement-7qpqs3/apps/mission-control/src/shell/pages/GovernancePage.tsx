/**
 * GovernancePage — the control surface the repository grants the agent: the
 * real .qodo/policy.yml from trunk (budget cap, autonomy floor, approval
 * gate), installable in one tap when absent, plus the full catalog of agent
 * CLI modes — every capability the toolchain has, with copyable commands.
 */
import React, { useCallback, useEffect, useState } from "react";
import { UI, FONT, MONO, Panel, ScrollArea, CardGrid, StatTile, SectionTitle, Button, Pill, EmptyState } from "../ui.js";
import { Icon } from "../icons.js";
import { ConnectHero } from "../ConnectSurface.js";
import { getGitHubConfig } from "../github/config.js";
import { fetchRepoPolicy, installExamplePolicy, type PolicyFetchResult } from "../github/policy.js";
import { setDocsIntent } from "../docsIntent.js";
import { ReceiptPanel } from "../ReceiptPanel.js";
import type { PageProps } from "../PlatformShell.js";

const AUTONOMY_BLURB: Record<string, string> = {
  full: "normal operation — the agent commits, canaries, and merges",
  mentor: "a human approves before the Ghost Commit",
  "dry-run": "plan, gate, and simulate only — never commit, deploy, or merge",
  unrecognized: "value not recognized — check the file",
};

const APPROVAL_BLURB: Record<string, string> = {
  manual: "always require approval before the Ghost Commit",
  trust: "auto-proceed on a high trust-ledger bond, otherwise ask",
  auto: "never require the interactive gate (owner pre-approves)",
  unrecognized: "value not recognized — check the file",
};

interface CliMode {
  flag: string;
  name: string;
  blurb: string;
  color: string;
}

const CLI_MODES: CliMode[] = [
  { flag: "--doctor", name: "Doctor", color: UI.green, blurb: "One-shot readiness report — checks keys, Redis, GitHub token, and policy validity, then explains what the next run will do." },
  { flag: "--policy", name: "Policy inspector", color: UI.indigo, blurb: "Prints the effective control surface (budget, autonomy, approval) with zero credentials; non-zero exit on an invalid policy." },
  { flag: "--eval", name: "Sovereign eval", color: UI.cyan, blurb: "Runs the whole real pipeline against a deterministic local simulator — phases, gates, patch, and a cryptographically verified audit chain. $0." },
  { flag: "--janitor-mode", name: "Janitor", color: UI.amber, blurb: "Scans the repo for hygiene issues — dead code, risky patterns, missing guards — and opens fix PRs." },
  { flag: "--evolve", name: "Darwin engine", color: UI.purple, blurb: "Evolves the agents' own prompts against past outcomes and opens a PR with the improvement." },
  { flag: "--compliance-mode", name: "Compliance oracle", color: UI.red, blurb: "Audits the repo against compliance rules and opens remediation PRs for the gaps it finds." },
  { flag: "--drain-trigger-queue", name: "Resume drain", color: UI.indigoLight, blurb: "Drains the resume queue — dispatches the runs that /qodo-proceed and webhooks enqueued (ADR-005)." },
  { flag: "--rehearse", name: "$0 rehearsal", color: UI.cyan, blurb: "Simulates the whole mission in-process BEFORE the real run and binds the rehearsal's envelope hash into the run's receipt. QODO_REHEARSE_ENFORCE=true halts on a closed rehearsal gate." },
  { flag: "--receipt-verify", name: "Receipt verifier", color: UI.green, blurb: "Verifies a Verifiable Autonomy Receipt offline — signature, consistency, and audit-chain anchoring. Also available with zero install: scripts/verify-receipt.mjs." },
];

export function GovernancePage(props: PageProps): React.ReactElement {
  const { mc, navigate } = props;
  if (mc.source === "none") {
    return <ScrollArea><ConnectHero mc={mc} navigate={navigate} /></ScrollArea>;
  }
  return <GovernanceBody {...props} />;
}

function GovernanceBody({ mc, navigate }: PageProps): React.ReactElement {
  const github = mc.source === "github";
  const [res, setRes] = useState<PolicyFetchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const c = getGitHubConfig();
    if (!c) return;
    setError(null);
    try {
      setRes(await fetchRepoPolicy(c));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "failed to read policy");
    }
  }, []);

  useEffect(() => { if (github) void load(); }, [github, load]);

  const install = async () => {
    const c = getGitHubConfig();
    if (!c) return;
    setBusy(true);
    try {
      await installExamplePolicy(c);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "install failed");
    } finally {
      setBusy(false);
    }
  };

  const p = res?.policy;

  return (
    <ScrollArea>
      <SectionTitle right={github ? <button onClick={() => void load()} style={linkStyle}>refresh</button> : undefined}>
        Repository policy
      </SectionTitle>

      {!github ? (
        <Panel style={{ marginBottom: 22 }}>
          <EmptyState icon="⛨" title="Policy lives in your repository"
            hint="Connect GitHub in Connections to read .qodo/policy.yml from trunk — budget cap, autonomy floor, and the approval gate." />
        </Panel>
      ) : error ? (
        <Panel pad={14} style={{ marginBottom: 22 }}><span style={{ color: UI.red, fontSize: 12.5 }}>{error}</span></Panel>
      ) : res == null ? (
        <Panel pad={14} style={{ marginBottom: 22 }}><span style={{ color: UI.textMuted, fontSize: 12.5 }}>Reading policy from trunk…</span></Panel>
      ) : !res.found ? (
        <Panel pad={18} style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: UI.textPrimary, marginBottom: 6 }}>No policy file — defaults apply</div>
          <div style={{ fontSize: 12.5, color: UI.textMuted, lineHeight: 1.6, marginBottom: 14 }}>
            Without <span style={{ fontFamily: MONO }}>.qodo/policy.yml</span> the agent runs with <strong style={{ color: UI.textSecondary }}>autonomy: full</strong>, no
            spend cap, and today's approval behavior. Installing the example commits a starter policy to your default branch — a real commit you can edit any time.
          </div>
          <Button variant="primary" onClick={install} disabled={busy}>
            <Icon name="governance" size={15} /> {busy ? "Committing…" : "Install example policy"}
          </Button>
        </Panel>
      ) : (
        <>
          <CardGrid min={196} gap={14} style={{ marginBottom: 10 }}>
            <StatTile label="Budget cap" accent={p?.budgetMaxUsdCents != null ? UI.green : UI.amber}
              value={p?.budgetMaxUsdCents != null ? `$${(p.budgetMaxUsdCents / 100).toFixed(2)}` : "No cap"}
              sub={p?.budgetMaxUsdCents != null ? "hard per-run spend limit" : "runs are not spend-limited"} />
            <StatTile label="Autonomy" accent={p?.autonomy === "full" ? UI.green : p?.autonomy === "mentor" ? UI.amber : p?.autonomy === "dry-run" ? UI.indigoLight : UI.textMuted}
              value={p?.autonomy ?? "default"}
              sub={AUTONOMY_BLURB[p?.autonomy ?? ""] ?? "defaults to full"} />
            <StatTile label="Approval" accent={p?.approval === "auto" ? UI.green : p?.approval === "trust" ? UI.cyan : p?.approval === "manual" ? UI.amber : UI.textMuted}
              value={p?.approval ?? "default"}
              sub={APPROVAL_BLURB[p?.approval ?? ""] ?? "inherits current behavior"} />
          </CardGrid>
          <div style={{ fontSize: 11.5, color: UI.textMuted, lineHeight: 1.55, marginBottom: 22 }}>
            Read from <span style={{ fontFamily: MONO, color: UI.textSecondary }}>{res.path}</span> on the default branch — policies come from trunk,
            so a pull request can never loosen its own guardrails.{" "}
            <button onClick={() => { setDocsIntent("docs/POLICY.md"); navigate("docs"); }} style={linkStyle}>Read the policy guide ›</button>
          </div>
        </>
      )}

      {github && <div style={{ marginBottom: 22 }}><ReceiptPanel /></div>}

      <SectionTitle>Agent modes · the full toolchain</SectionTitle>
      <div style={{ fontSize: 12.5, color: UI.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
        Everything the agent CLI can do beyond the delivery pipeline. These run in CI or any terminal with the repo checked out.
      </div>
      <CardGrid min={260} gap={12} style={{ marginBottom: 8 }}>
        {CLI_MODES.map((m) => <CliModeCard key={m.flag} mode={m} />)}
      </CardGrid>
    </ScrollArea>
  );
}

function CliModeCard({ mode }: { mode: CliMode }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const cmd = `node packages/agent/dist/cli.js ${mode.flag}`;
  const copy = () => {
    navigator.clipboard?.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <Panel pad={14} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: UI.textPrimary }}>{mode.name}</span>
        <Pill color={mode.color}>{mode.flag}</Pill>
      </div>
      <div style={{ fontSize: 12, color: UI.textMuted, lineHeight: 1.5, flex: 1 }}>{mode.blurb}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: UI.bgElevated, border: `1px solid ${UI.border}`, borderRadius: 8, padding: "7px 10px" }}>
        <code style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: MONO, fontSize: 10.5, color: UI.textSecondary }}>{cmd}</code>
        <button onClick={copy} aria-label={`Copy ${mode.flag} command`}
          style={{ background: "none", border: "none", cursor: "pointer", color: copied ? UI.green : UI.indigoLight, display: "grid", placeItems: "center", padding: 2, flexShrink: 0 }}>
          {copied ? <Icon name="check" size={14} /> : <Icon name="copy" size={14} />}
        </button>
      </div>
    </Panel>
  );
}

const linkStyle: React.CSSProperties = {
  background: "none", border: "none", padding: 0, cursor: "pointer",
  color: UI.indigoLight, fontSize: 12, fontWeight: 600, fontFamily: FONT,
};
