/**
 * ReceiptPanel — verify Verifiable Autonomy Receipts on the device. Two
 * paths: fetch a `receipt-*` CI artifact (with its `audit-log-*` sibling for
 * chain anchoring) and verify it, or paste receipt JSON directly — the paste
 * path always works, even when artifact zips can't be fetched cross-origin.
 * Verification runs the SAME `verifyReceipt` the agent ships (imported from
 * the agent source via the @qodo/agent alias) — one verifier, every surface.
 */
import React, { useEffect, useState } from "react";
import { verifyReceipt, type AutonomyReceipt, type ReceiptVerification } from "@qodo/agent/services/receipt";
import { UI, FONT, MONO, Panel, Button, Pill, Dot, SectionTitle, timeAgo } from "./ui.js";
import { plural } from "../utils/plural.js";
import { Icon } from "./icons.js";
import { getGitHubConfig } from "./github/config.js";
import { ghListArtifacts, ghDownloadArtifactZip, type GhArtifact } from "./github/client.js";
import { unzip, zipEntryText } from "./github/unzip.js";
import { formatBytes } from "./github/encoding.js";

interface VerifyState {
  receipt: AutonomyReceipt;
  result: ReceiptVerification;
  chainChecked: boolean;
}

export function ReceiptPanel(): React.ReactElement {
  const [artifacts, setArtifacts] = useState<GhArtifact[] | null>(null);
  const [auditArtifacts, setAuditArtifacts] = useState<GhArtifact[]>([]);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState<number | "paste" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<VerifyState | null>(null);

  useEffect(() => {
    const cfg = getGitHubConfig();
    if (!cfg) { setArtifacts([]); return; }
    ghListArtifacts(cfg)
      .then((all) => {
        setArtifacts(all.filter((a) => a.name.startsWith("receipt-") && !a.expired).slice(0, 5));
        setAuditArtifacts(all.filter((a) => a.name.startsWith("audit-log-")));
      })
      .catch((e: unknown) => { setArtifacts([]); setError(e instanceof Error ? e.message : "failed to list artifacts"); });
  }, []);

  const verifyText = async (jsonText: string, auditNdjson?: string, chainChecked = false) => {
    const receipt = JSON.parse(jsonText) as AutonomyReceipt;
    const result = await verifyReceipt(receipt, { auditNdjson });
    setState({ receipt, result, chainChecked });
    setError(null);
  };

  const verifyPasted = async () => {
    setBusy("paste");
    try {
      await verifyText(pasted);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "invalid receipt JSON");
    } finally {
      setBusy(null);
    }
  };

  const verifyArtifact = async (a: GhArtifact) => {
    const cfg = getGitHubConfig();
    if (!cfg) return;
    setBusy(a.id);
    setError(null);
    try {
      const zipBuf = await (await ghDownloadArtifactZip(cfg, a.id)).arrayBuffer();
      const entries = await unzip(zipBuf);
      const receiptEntry = entries.find((e) => e.name.endsWith("receipt.json")) ?? entries[0];
      if (!receiptEntry) throw new Error("archive holds no receipt.json");

      // Best-effort: pull the sibling audit log (same run-id suffix) so the
      // chain-anchoring checks run too.
      let auditNdjson: string | undefined;
      const runSuffix = a.name.replace(/^receipt-/, "");
      const sibling = auditArtifacts.find((x) => x.name === `audit-log-${runSuffix}`);
      if (sibling && !sibling.expired) {
        try {
          const auditZip = await (await ghDownloadArtifactZip(cfg, sibling.id)).arrayBuffer();
          const auditEntry = (await unzip(auditZip)).find((e) => e.name.endsWith(".ndjson"));
          if (auditEntry) auditNdjson = zipEntryText(auditEntry);
        } catch { /* receipt-only verification below */ }
      }
      await verifyText(zipEntryText(receiptEntry), auditNdjson, auditNdjson != null);
    } catch (e: unknown) {
      setError(`${e instanceof Error ? e.message : "artifact fetch failed"} — paste the receipt JSON below instead.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <SectionTitle>Autonomy receipts</SectionTitle>
      <div style={{ fontSize: 12.5, color: UI.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
        Every agent run issues a cryptographic receipt — policy hash, gate verdicts, approval provenance, spend, and the
        audit-chain anchor. Verify one right here, offline logic, on this device.
      </div>

      {artifacts == null ? (
        <Panel pad={14} style={{ marginBottom: 12 }}><span style={{ fontSize: 12.5, color: UI.textMuted }}>Looking for receipt artifacts…</span></Panel>
      ) : artifacts.length > 0 && (
        <Panel pad={6} style={{ marginBottom: 12 }}>
          {artifacts.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: `1px solid ${UI.border}`, flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 140px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, fontFamily: MONO, color: UI.textPrimary }}>{a.name}</span>
              <span style={{ fontSize: 11.5, color: UI.textMuted, flexShrink: 0 }}>{formatBytes(a.sizeInBytes)} · {timeAgo(a.createdAt)}</span>
              <Button onClick={() => void verifyArtifact(a)} disabled={busy != null}>
                <Icon name="safety" size={13} /> {busy === a.id ? "Verifying…" : "Verify"}
              </Button>
            </div>
          ))}
        </Panel>
      )}

      <Panel pad={14} style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", fontWeight: 700, color: UI.textMuted, marginBottom: 8 }}>
          Paste receipt JSON
        </div>
        <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} spellCheck={false}
          placeholder='{"schema":"qodo.receipt/v1", …}'
          style={{ width: "100%", boxSizing: "border-box", minHeight: 96, resize: "vertical", borderRadius: 9, border: `1px solid ${UI.borderStrong}`, outline: "none", padding: "10px 12px", background: UI.bgElevated, color: UI.textPrimary, fontFamily: MONO, fontSize: 11.5, lineHeight: 1.5 }} />
        <div style={{ marginTop: 8 }}>
          <Button variant="primary" onClick={() => void verifyPasted()} disabled={busy != null || pasted.trim().length < 10}>
            <Icon name="safety" size={14} /> {busy === "paste" ? "Verifying…" : "Verify receipt"}
          </Button>
        </div>
      </Panel>

      {error && (
        <Panel pad={12} style={{ marginBottom: 12 }}>
          <span role="alert" style={{ fontSize: 12.5, color: UI.red, overflowWrap: "anywhere" }}>{error}</span>
        </Panel>
      )}

      {state && <VerificationResult {...state} />}
    </div>
  );
}

function VerificationResult({ receipt, result, chainChecked }: VerifyState): React.ReactElement {
  const r = receipt;
  const outcomeColor = r.run.outcome === "done" ? UI.green : r.run.outcome === "halted" ? UI.amber : UI.red;
  return (
    <>
      <Panel pad={6} style={{ marginBottom: 12 }}>
        {result.checks.map((c) => (
          <div key={c.name} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 12px", borderBottom: `1px solid ${UI.border}` }}>
            <Dot color={c.ok ? UI.green : UI.red} glow={c.ok} />
            <span style={{ flex: "0 1 140px", minWidth: 90, fontSize: 12.5, fontWeight: 600, color: UI.textPrimary, fontFamily: MONO }}>{c.name}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: UI.textMuted, overflowWrap: "anywhere" }}>{c.detail}</span>
            <Pill color={c.ok ? UI.green : UI.red}>{c.ok ? "ok" : "fail"}</Pill>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px" }}>
          <Pill color={result.valid ? UI.green : UI.red} solid>{result.valid ? "RECEIPT VALID" : "RECEIPT INVALID"}</Pill>
          {!chainChecked && <span style={{ fontSize: 11.5, color: UI.textMuted }}>chain anchoring not checked (no audit log provided)</span>}
        </div>
      </Panel>

      <Panel pad={16}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: UI.textWhite, fontFamily: MONO }}>{r.run.runId}</span>
          <Pill color={outcomeColor}>{r.run.outcome}</Pill>
          {r.signature ? <Pill color={UI.indigo}>signed · {r.signature.keyId}</Pill> : <Pill color={UI.textMuted}>unsigned</Pill>}
          {r.rehearsal && <Pill color={UI.cyan}>rehearsed</Pill>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(200px, 100%), 1fr))", gap: 10, fontSize: 12 }}>
          <Fact label="Repository" value={`${r.subject.owner}/${r.subject.repo} · PR #${r.subject.prNumber}`} />
          <Fact label="Policy" value={r.controls.policy.sha256 ? `${r.controls.policy.source} · ${r.controls.policy.sha256.slice(0, 12)}…` : "defaults (no policy file)"} />
          <Fact label="Autonomy / approval" value={`${r.controls.policy.autonomy} · ${r.controls.approval.mode} → ${r.controls.approval.decision}`} />
          <Fact label="Gates" value={r.controls.gates ? (r.controls.gates.gateOpen ? "OPEN — all validators passed" : "CLOSED") : "not reached"} />
          <Fact label="Spend" value={`${r.controls.budget.spentCents}¢${r.controls.budget.capCents != null ? ` of ${r.controls.budget.capCents}¢ cap` : " (no cap)"}`} />
          <Fact label="Trust bond" value={`${r.controls.trust.category} · score ${r.controls.trust.score}${r.controls.trust.canAutoMerge ? " · auto-merge" : ""}`} />
          <Fact label="Diff" value={r.subject.diffSha256 ? `${plural(r.subject.filesTouched.length, "file")} · ${r.subject.diffSha256.slice(0, 12)}…` : "no patch"} />
          <Fact label="Audit chain" value={`${plural(r.evidence.auditEntries, "entry", "entries")} · head seq ${r.evidence.auditHead.seq}`} />
          {r.rehearsal && <Fact label="Rehearsal" value={`gate ${r.rehearsal.gateOpen ? "open" : "closed"} · ${plural(r.rehearsal.filesPredicted.length, "file")} predicted · ${r.rehearsal.envelopeSha256.slice(0, 12)}…`} />}
        </div>
      </Panel>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", fontWeight: 700, color: UI.textMuted, marginBottom: 3, fontFamily: FONT }}>{label}</div>
      <div style={{ color: UI.textSecondary, overflowWrap: "anywhere", lineHeight: 1.45 }}>{value}</div>
    </div>
  );
}
