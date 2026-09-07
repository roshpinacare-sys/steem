/**
 * ECOS Mission Detail — V96
 * ─────────────────────────────────────────────────────────────────────────────
 * Transparent mission ledger page. Fetches the Express mission-detail endpoint
 * and renders the complete human/AI decision trail, cryptographic audit hashes,
 * and settlement economics in one place.
 *
 * V96 additions (additive only):
 *  1. "Copy mission ID" button next to the mission ID
 *  2. Raw + calibrated confidence progress bars (red/yellow/green)
 *  3. "Share" button that copies window.location.href to clipboard
 *  4. "Knowledge Patches Applied: N" badge + patch-ID list when patches present
 *  5. Economic split: horizontal stacked bar [Platform 40%][Validator 40%][Insurance 20%]
 */

'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';

const EXPRESS_BASE =
  typeof window !== 'undefined' && window.__ECOS_EXPRESS_URL__
    ? window.__ECOS_EXPRESS_URL__
    : (process.env.NEXT_PUBLIC_EXPRESS_URL || 'http://localhost:3000');

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); }
  catch (_) { return '—'; }
}

function shortId(id, head = 14) {
  if (!id) return '—';
  const s = String(id);
  return s.length > head ? `${s.slice(0, head)}…` : s;
}

function badgeStyle(value) {
  const v = String(value || '').toUpperCase();
  if (['APPROVED', 'APPROVE', 'AUTO_FLOW'].includes(v)) return { background: '#064e3b', color: '#34d399', border: '#047857' };
  if (['MODIFIED', 'MODIFY', 'HITL', 'HITL_QUEUE', 'MIXED'].includes(v)) return { background: '#78350f', color: '#fcd34d', border: '#b45309' };
  if (['REJECTED', 'REJECT', 'HARD_REJECT'].includes(v)) return { background: '#7f1d1d', color: '#fca5a5', border: '#b91c1c' };
  if (v === 'PENDING') return { background: '#1e3a5f', color: '#93c5fd', border: '#2563eb' };
  return { background: '#374151', color: '#d1d5db', border: '#4b5563' };
}

function Badge({ children }) {
  const c = badgeStyle(children);
  return <span style={{ ...S.badge, background: c.background, color: c.color, borderColor: c.border }}>{children || 'UNKNOWN'}</span>;
}

function StatCard({ label, value, tone = 'default' }) {
  const color = tone === 'green' ? '#34d399' : tone === 'yellow' ? '#fcd34d' : tone === 'blue' ? '#93c5fd' : '#e5e7eb';
  return (
    <div style={S.statCard}>
      <div style={S.statLabel}>{label}</div>
      <div style={{ ...S.statValue, color }}>{value}</div>
    </div>
  );
}

function Section({ title, children, action }) {
  return (
    <section style={S.section}>
      <div style={S.sectionHeader}>
        <h2 style={S.sectionTitle}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function renderJson(value) {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); }
  catch (_) { return String(value); }
}

/** Copy text to clipboard and briefly show feedback via a setter. */
function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = useCallback((text) => {
    if (typeof navigator === 'undefined') return;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, []);
  return [copied, copy];
}

/** Confidence progress bar — colour-coded red/yellow/green. */
function ConfidenceBar({ label, value }) {
  if (value == null) return null;
  const pct   = Math.max(0, Math.min(1, value)) * 100;
  const color = pct < 50 ? '#ef4444' : pct < 70 ? '#fcd34d' : '#34d399';
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ color: '#9ca3af', fontSize: 12 }}>{label}</span>
        <span style={{ color, fontSize: 12, fontWeight: 700 }}>{pct.toFixed(1)}%</span>
      </div>
      <div style={{ background: '#374151', borderRadius: 6, height: 8, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: 6, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
}

/** Horizontal stacked economic split bar: Platform 40% | Validator 40% | Insurance 20% */
function EconomicSplitBar({ priceUsd }) {
  const price = parseFloat(priceUsd || '0') || 0;
  const segments = [
    { label: 'Platform',  pct: 40, color: '#3b82f6', amount: (price * 0.40).toFixed(2) },
    { label: 'Validator', pct: 40, color: '#10b981', amount: (price * 0.40).toFixed(2) },
    { label: 'Insurance', pct: 20, color: '#f59e0b', amount: (price * 0.20).toFixed(2) },
  ];
  return (
    <div style={{ marginTop: 12 }}>
      {/* Stacked bar */}
      <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', height: 28 }}>
        {segments.map(seg => (
          <div
            key={seg.label}
            style={{ width: `${seg.pct}%`, background: seg.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>{seg.pct}%</span>
          </div>
        ))}
      </div>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 18, marginTop: 8, flexWrap: 'wrap' }}>
        {segments.map(seg => (
          <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: seg.color }} />
            <span style={{ color: '#9ca3af', fontSize: 12 }}>
              {seg.label} <span style={{ color: '#e5e7eb', fontWeight: 700 }}>${seg.amount}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MissionDetailPage({ params }) {
  const missionParam = params?.id;
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const [idCopied,    copyId]    = useCopy();
  const [shareCopied, copyShare] = useCopy();

  useEffect(() => {
    if (!missionParam) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`${EXPRESS_BASE}/api/v1/mission/${encodeURIComponent(missionParam)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Mission lookup failed (${res.status})`);
        return body;
      })
      .then(body => { if (!cancelled) setData(body); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [missionParam]);

  const approvals       = data?.approvals      || [];
  const auditTrail      = data?.auditTrail      || [];
  const ledgerEntries   = data?.ledgerEntries   || [];
  const summary         = data?.summary         || {};
  const primaryApproval = approvals[0]          || null;

  // Patches applied to this mission
  const appliedPatches  = useMemo(() => {
    if (Array.isArray(data?.patches) && data.patches.length > 0) return data.patches;
    // Also check approval context for patch refs
    const patchIds = [];
    for (const apv of approvals) {
      const pid = apv?.context?.knowledgePatch?.patchId;
      if (pid && !patchIds.includes(pid)) patchIds.push(pid);
    }
    return patchIds;
  }, [data, approvals]);

  const economics = useMemo(() => {
    const buckets = new Map();
    for (const entry of ledgerEntries) {
      const key = entry.to || entry.from || entry.kind || 'unknown';
      if (!buckets.has(key)) buckets.set(key, { account: key, amount: 0, entries: 0, legs: [] });
      const row = buckets.get(key);
      row.amount += parseFloat(entry.amountUsd || '0') || 0;
      row.entries += 1;
      row.legs.push(entry.meta?.leg || entry.kind || 'entry');
    }
    return Array.from(buckets.values()).sort((a, b) => b.amount - a.amount);
  }, [ledgerEntries]);

  if (loading) {
    return <div style={S.root}><div style={S.loading}>Loading mission detail…</div></div>;
  }

  if (error) {
    return (
      <div style={S.root}>
        <div style={S.errorCard}>
          <h1 style={S.title}>Mission not found</h1>
          <p style={S.muted}>{error}</p>
          <a href="/dashboard" style={S.linkButton}>Back to Dashboard</a>
        </div>
      </div>
    );
  }

  const missionId   = data?.missionId || missionParam || '';
  const rawConf     = primaryApproval?.confidence ?? null;
  // calibratedConfidence is stored separately when available
  const calConf     = primaryApproval?.calibratedConfidence ?? null;
  const priceUsd    = summary?.totalBilledUsd || primaryApproval?.priceUsd || '0.00';

  return (
    <div style={S.root}>
      <div style={S.topbar}>
        <div>
          <div style={S.kicker}>Mission Detail</div>
          {/* Mission ID + Copy button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={S.title}>{shortId(missionId, 28)}</h1>
            <button
              onClick={() => copyId(missionId)}
              title="Copy mission ID"
              style={S.copyBtn}
            >
              {idCopied ? '✓ Copied' : '⎘ Copy ID'}
            </button>
          </div>
          <div style={S.subtle}>Full audit trail, approvals, and settlement economics for this mission.</div>
        </div>
        <div style={S.actions}>
          {/* Share button */}
          <button
            onClick={() => copyShare(typeof window !== 'undefined' ? window.location.href : '')}
            title="Copy page URL to clipboard"
            style={S.shareBtn}
          >
            {shareCopied ? '✓ Link copied!' : '↗ Share'}
          </button>
          <a href="/chat" style={S.secondaryLink}>Chat</a>
          <a href="/dashboard" style={S.secondaryLink}>Dashboard</a>
          {primaryApproval?.id && (
            <a href={`/validator?approval=${encodeURIComponent(primaryApproval.id)}`} style={S.primaryLink}>
              Validator Queue
            </a>
          )}
        </div>
      </div>

      <div style={S.statsGrid}>
        <StatCard label="Flow"         value={summary.flow || '—'}                                                                    tone="blue" />
        <StatCard label="Decision"     value={summary.decision || primaryApproval?.decision || primaryApproval?.status || 'pending'} tone="yellow" />
        <StatCard label="Total billed" value={`$${summary.totalBilledUsd || '0.0000'}`}                                               tone="green" />
        <StatCard label="Approvals"    value={`${summary.resolved || 0}/${summary.totalApprovals || approvals.length} resolved`} />
      </div>

      {/* Knowledge Patches Applied badge */}
      {appliedPatches.length > 0 && (
        <div style={S.patchBanner}>
          <span style={S.patchBadge}>🧩 Knowledge Patches Applied: {appliedPatches.length}</span>
          <div style={S.patchIdList}>
            {appliedPatches.map((pid, i) => (
              <code key={i} style={S.code}>{typeof pid === 'string' ? pid : JSON.stringify(pid)}</code>
            ))}
          </div>
        </div>
      )}

      {/* Confidence visualization */}
      {(rawConf != null || calConf != null) && (
        <div style={S.confSection}>
          <div style={S.confTitle}>Confidence</div>
          {rawConf != null  && <ConfidenceBar label="Raw confidence"        value={rawConf} />}
          {calConf != null  && <ConfidenceBar label="Calibrated confidence" value={calConf} />}
        </div>
      )}

      <div style={S.gridTwo}>
        <Section title="Mission Timeline">
          <div style={S.timeline}>
            {approvals.map((approval, idx) => (
              <div key={approval.id || idx} style={S.timelineItem}>
                <div style={S.dot} />
                <div style={S.timelineBody}>
                  <div style={S.timelineTop}>
                    <Badge>{approval.status}</Badge>
                    <span style={S.mutedSmall}>{fmtDate(approval.createdAt)}</span>
                  </div>
                  <div style={S.row}><span>Approval</span><code style={S.code}>{approval.id}</code></div>
                  <div style={S.row}><span>Client</span><code style={S.code}>{approval.clientAccountId}</code></div>
                  <div style={S.row}><span>Validator</span><code style={S.code}>{approval.validatorAccountId || 'AUTO / not assigned'}</code></div>
                  <div style={S.row}><span>Confidence</span><span>{approval.confidence != null ? `${(approval.confidence * 100).toFixed(1)}%` : '—'}</span></div>
                  <div style={S.row}><span>Resolved</span><span>{fmtDate(approval.resolvedAt)}</span></div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Decision Output">
          <div style={S.outputGrid}>
            <div>
              <div style={S.label}>AI Output</div>
              <pre style={S.pre}>{renderJson(primaryApproval?.aiOutput)}</pre>
            </div>
            <div>
              <div style={S.label}>Final Output</div>
              <pre style={S.pre}>{renderJson(primaryApproval?.finalOutput)}</pre>
            </div>
          </div>
        </Section>
      </div>

      <Section title="Economics — 40/40/20 split">
        {/* Stacked split bar */}
        <EconomicSplitBar priceUsd={priceUsd} />

        {ledgerEntries.length === 0 ? (
          <div style={{ ...S.empty, marginTop: 14 }}>No ledger entries yet. Pending or rejected missions do not create settlement rows.</div>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 14 }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Entry</th>
                  <th style={S.th}>Leg</th>
                  <th style={S.th}>From</th>
                  <th style={S.th}>To</th>
                  <th style={S.th}>Amount</th>
                  <th style={S.th}>Split</th>
                </tr>
              </thead>
              <tbody>
                {ledgerEntries.map(entry => (
                  <tr key={entry.id}>
                    <td style={S.td}><code style={S.code}>{entry.id}</code></td>
                    <td style={S.td}>{entry.meta?.leg || entry.kind}</td>
                    <td style={S.td}><code style={S.code}>{entry.from || '—'}</code></td>
                    <td style={S.td}><code style={S.code}>{entry.to || '—'}</code></td>
                    <td style={{ ...S.td, color: '#34d399', fontWeight: 700 }}>${entry.amountUsd}</td>
                    <td style={S.td}>{entry.meta?.split || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {economics.length > 0 && (
          <div style={S.bucketGrid}>
            {economics.map(bucket => (
              <div key={bucket.account} style={S.bucketCard}>
                <code style={S.bucketAccount}>{bucket.account}</code>
                <div style={S.bucketAmount}>${bucket.amount.toFixed(4)}</div>
                <div style={S.mutedSmall}>{bucket.entries} ledger entries</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Cryptographic Audit Trail">
        {auditTrail.length === 0 ? (
          <div style={S.empty}>No audit entries were found for this mission.</div>
        ) : (
          <div style={S.auditList}>
            {auditTrail.map(entry => (
              <div key={entry.hash} style={S.auditItem}>
                <div style={S.auditTop}>
                  <Badge>{entry.type}</Badge>
                  <span style={S.mutedSmall}>#{entry.index} · {fmtDate(entry.ts)}</span>
                </div>
                <div style={S.row}><span>Hash</span><code style={S.code}>{entry.hash}</code></div>
                <div style={S.row}><span>Previous</span><code style={S.code}>{entry.prevHash || 'GENESIS'}</code></div>
                <pre style={S.preSmall}>{renderJson(entry.payload)}</pre>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Patch / Royalty Hooks">
        <div style={S.empty}>
          {appliedPatches.length > 0
            ? `${appliedPatches.length} patch hook(s) are attached to this mission.`
            : 'No patch artifacts are attached yet. This panel is ready for future royalty-trigger metadata.'}
        </div>
      </Section>
    </div>
  );
}

const S = {
  root: {
    minHeight: 'calc(100vh - 56px)',
    background: '#111827',
    color: '#e5e7eb',
    padding: 24,
    fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
  },
  topbar: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 20,
    alignItems: 'flex-start',
    marginBottom: 22,
  },
  kicker: { color: '#60a5fa', fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' },
  title:  { margin: '4px 0 8px', fontSize: 28, fontWeight: 800, color: '#f9fafb' },
  subtle: { color: '#9ca3af', fontSize: 14 },
  actions: { display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' },
  primaryLink:   { background: '#1d4ed8', color: '#fff', padding: '9px 13px', borderRadius: 8, textDecoration: 'none', fontSize: 13, fontWeight: 700 },
  secondaryLink: { background: '#1f2937', color: '#d1d5db', padding: '9px 13px', border: '1px solid #374151', borderRadius: 8, textDecoration: 'none', fontSize: 13 },
  linkButton:    { display: 'inline-block', background: '#1d4ed8', color: '#fff', padding: '10px 14px', borderRadius: 8, textDecoration: 'none', marginTop: 14 },
  copyBtn: {
    background: '#1f2937', color: '#93c5fd', border: '1px solid #3b82f6',
    borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 700,
    cursor: 'pointer', whiteSpace: 'nowrap',
  },
  shareBtn: {
    background: '#064e3b', color: '#34d399', border: '1px solid #047857',
    borderRadius: 8, padding: '9px 13px', fontSize: 13, fontWeight: 700,
    cursor: 'pointer', whiteSpace: 'nowrap',
  },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 18 },
  statCard:  { background: '#1f2937', border: '1px solid #374151', borderRadius: 12, padding: 16 },
  statLabel: { color: '#9ca3af', fontSize: 12, marginBottom: 6 },
  statValue: { fontSize: 20, fontWeight: 800 },
  // Confidence
  confSection: { background: '#1f2937', border: '1px solid #374151', borderRadius: 12, padding: 16, marginBottom: 16 },
  confTitle:   { color: '#9ca3af', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 },
  // Patches banner
  patchBanner: { background: '#1a2e44', border: '1px solid #2563eb', borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  patchBadge:  { background: '#1d4ed8', color: '#fff', borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap' },
  patchIdList: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  // Layout
  gridTwo:      { display: 'grid', gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1.1fr)', gap: 16 },
  section:      { background: '#1f2937', border: '1px solid #374151', borderRadius: 12, padding: 16, marginBottom: 16 },
  sectionHeader:{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle: { margin: 0, fontSize: 16, color: '#f9fafb' },
  timeline:     { display: 'flex', flexDirection: 'column', gap: 14 },
  timelineItem: { display: 'flex', gap: 12 },
  dot:          { width: 11, height: 11, borderRadius: '50%', background: '#60a5fa', marginTop: 7, boxShadow: '0 0 0 4px rgba(96,165,250,0.12)' },
  timelineBody: { flex: 1, borderLeft: '1px solid #374151', paddingLeft: 12 },
  timelineTop:  { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 8 },
  row:          { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', borderBottom: '1px solid rgba(55,65,81,0.55)', fontSize: 13 },
  label:        { color: '#9ca3af', fontSize: 12, marginBottom: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' },
  outputGrid:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  pre:          { background: '#111827', border: '1px solid #374151', borderRadius: 8, padding: 12, color: '#d1d5db', whiteSpace: 'pre-wrap', overflowX: 'auto', minHeight: 160, fontSize: 12 },
  preSmall:     { background: '#111827', border: '1px solid #374151', borderRadius: 8, padding: 10, color: '#9ca3af', whiteSpace: 'pre-wrap', overflowX: 'auto', fontSize: 11, marginTop: 8 },
  table:        { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:           { textAlign: 'left', color: '#9ca3af', borderBottom: '1px solid #374151', padding: '9px 8px' },
  td:           { borderBottom: '1px solid #374151', padding: '9px 8px', verticalAlign: 'top' },
  code:         { background: '#111827', border: '1px solid #374151', borderRadius: 5, padding: '1px 5px', color: '#93c5fd', fontSize: 12, wordBreak: 'break-all' },
  badge:        { display: 'inline-block', padding: '4px 10px', borderRadius: 999, border: '1px solid', fontSize: 11, fontWeight: 800, letterSpacing: '0.05em' },
  empty:        { background: '#111827', border: '1px dashed #374151', borderRadius: 10, padding: 14, color: '#9ca3af', fontSize: 13 },
  auditList:    { display: 'flex', flexDirection: 'column', gap: 12 },
  auditItem:    { background: '#111827', border: '1px solid #374151', borderRadius: 10, padding: 12 },
  auditTop:     { display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 },
  bucketGrid:        { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, marginTop: 14 },
  bucketCard:        { background: '#111827', border: '1px solid #374151', borderRadius: 10, padding: 12 },
  bucketAccount:     { color: '#93c5fd', fontSize: 11, wordBreak: 'break-all' },
  bucketAmount:      { color: '#34d399', fontSize: 18, fontWeight: 800, marginTop: 8 },
  bucketGridSmall:   { display: 'grid', gap: 8 },
  bucketAccountSmall:{ color: '#93c5fd' },
  muted:        { color: '#9ca3af' },
  mutedSmall:   { color: '#9ca3af', fontSize: 12 },
  loading:      { color: '#9ca3af', padding: 40, textAlign: 'center' },
  errorCard:    { maxWidth: 620, margin: '60px auto', background: '#1f2937', border: '1px solid #374151', borderRadius: 12, padding: 24 },
};


