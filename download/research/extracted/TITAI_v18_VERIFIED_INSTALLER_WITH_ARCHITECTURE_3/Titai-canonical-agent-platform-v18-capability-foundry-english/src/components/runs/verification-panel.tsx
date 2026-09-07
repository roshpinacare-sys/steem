"use client";

import * as React from "react";
import { CheckCircle2, Fingerprint, ShieldX, Stamp, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { VerificationAttestation as VerificationRow } from "@/lib/db/schema";

const HASH = /^[a-f0-9]{64}$/i;

type Draft = {
  requirementRevision: string;
  taskRevision: string;
  sourceTreeHash: string;
  testCommand: string;
  testOutputHash: string;
  releaseCandidateHash: string;
  status: "accepted" | "rejected";
  limitations: string;
};

const initialDraft: Draft = {
  requirementRevision: "requirement@current",
  taskRevision: "task@current",
  sourceTreeHash: "",
  testCommand: "",
  testOutputHash: "",
  releaseCandidateHash: "",
  status: "rejected",
  limitations: "Independent verification has not yet been completed.",
};

export function VerificationPanel({ runId, initialAttestations }: { runId: string; initialAttestations: VerificationRow[] }) {
  const [rows, setRows] = React.useState(initialAttestations);
  const [draft, setDraft] = React.useState(initialDraft);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();

  const validHashes = HASH.test(draft.sourceTreeHash) && HASH.test(draft.testOutputHash) && HASH.test(draft.releaseCandidateHash);
  const canSubmit = validHashes && draft.testCommand.trim().length > 0 && draft.requirementRevision.trim().length > 0 && draft.taskRevision.trim().length > 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/runs/${runId}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requirementRevision: draft.requirementRevision,
          taskRevision: draft.taskRevision,
          sourceTreeHash: draft.sourceTreeHash,
          testCommand: draft.testCommand,
          testOutputHash: draft.testOutputHash,
          releaseCandidateHash: draft.releaseCandidateHash,
          status: draft.status,
          limitations: draft.limitations.split("\n").map((item) => item.trim()).filter(Boolean),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { attestation?: VerificationRow; error?: string };
      if (!response.ok || !payload.attestation) throw new Error(payload.error ?? "verification_attestation_failed");
      setRows((current) => [payload.attestation!, ...current.filter((row) => row.id !== payload.attestation!.id)]);
      setOpen(false);
      setDraft(initialDraft);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "verification_attestation_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="verification-plane" aria-labelledby="verification-plane-title">
      <header>
        <div>
          <span className="verification-plane__eyebrow"><Stamp className="size-4" /> Immutable review record</span>
          <h2 id="verification-plane-title">Independent verification</h2>
          <p>A decision is bound to source, test-output, artifact, and release hashes. A green run status is not a verification decision.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          <Fingerprint className="size-4" />{open ? "Close attestation" : "Record attestation"}
        </Button>
      </header>

      {open ? (
        <form onSubmit={submit} className="verification-plane__form" aria-label="Create verification attestation">
          <label>Requirement revision<Input value={draft.requirementRevision} onChange={(event) => setDraft({ ...draft, requirementRevision: event.target.value })} /></label>
          <label>Task revision<Input value={draft.taskRevision} onChange={(event) => setDraft({ ...draft, taskRevision: event.target.value })} /></label>
          <label className="verification-plane__wide">Source tree SHA-256<Input value={draft.sourceTreeHash} onChange={(event) => setDraft({ ...draft, sourceTreeHash: event.target.value.trim() })} placeholder="64 hexadecimal characters" /></label>
          <label className="verification-plane__wide">Test command<Input value={draft.testCommand} onChange={(event) => setDraft({ ...draft, testCommand: event.target.value })} placeholder="Exact reproducible command" /></label>
          <label className="verification-plane__wide">Test output SHA-256<Input value={draft.testOutputHash} onChange={(event) => setDraft({ ...draft, testOutputHash: event.target.value.trim() })} placeholder="64 hexadecimal characters" /></label>
          <label className="verification-plane__wide">Release candidate SHA-256<Input value={draft.releaseCandidateHash} onChange={(event) => setDraft({ ...draft, releaseCandidateHash: event.target.value.trim() })} placeholder="64 hexadecimal characters" /></label>
          <label>Decision<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as Draft["status"] })}><option value="rejected">Rejected</option><option value="accepted">Accepted</option></select></label>
          <label className="verification-plane__wide">Known limitations<textarea value={draft.limitations} onChange={(event) => setDraft({ ...draft, limitations: event.target.value })} rows={3} /></label>
          {error ? <p className="verification-plane__error" role="alert"><TriangleAlert className="size-4" />{error}</p> : null}
          <div className="verification-plane__actions"><Button type="submit" disabled={!canSubmit || busy}>{busy ? "Binding evidence…" : "Bind verification evidence"}</Button><small>Acceptance is disabled until every required hash is syntactically valid.</small></div>
        </form>
      ) : null}

      {rows.length ? (
        <ol className="verification-plane__list">
          {rows.map((row) => (
            <li key={row.id} data-status={row.status}>
              <div className="verification-plane__decision">{row.status === "accepted" ? <CheckCircle2 /> : <ShieldX />}<strong>{row.status}</strong><time>{row.createdAt ? new Date(row.createdAt).toLocaleString() : "Unknown time"}</time></div>
              <dl>
                <div><dt>Evidence</dt><dd><code>{row.evidenceHash}</code></dd></div>
                <div><dt>Source</dt><dd><code>{row.sourceTreeHash}</code></dd></div>
                <div><dt>Release</dt><dd><code>{row.releaseCandidateHash}</code></dd></div>
                <div><dt>Verifier</dt><dd>{row.verifierIdentity}</dd></div>
              </dl>
              {row.limitations.length ? <ul>{row.limitations.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No limitations were recorded.</p>}
            </li>
          ))}
        </ol>
      ) : (
        <div className="verification-plane__empty"><ShieldX className="size-5" /><div><strong>Not independently verified</strong><p>No immutable verification attestation is bound to this run.</p></div></div>
      )}
    </section>
  );
}
