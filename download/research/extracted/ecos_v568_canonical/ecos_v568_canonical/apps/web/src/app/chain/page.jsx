/**
 * ECOS Chain Explorer — V95
 * ─────────────────────────────────────────────────────────────────────────────
 * Blockchain-style audit explorer. Dark theme.
 *
 * HEADER: Chain stats bar
 *   GET /api/v1/stats  → chain.length, chain.headHash
 *   GET /api/v1/verify → ok status
 *   Shows: N entries · Head: abcd1234 · ✓ Intact / ✗ Broken
 *
 * MAIN: Mission explorer
 *   Input + Search → GET /api/v1/mission/:id
 *   Displays mission detail: missionId, clientAccountId, priceUsd, AI output,
 *   confidence, gate verdict, validator info, economic split, audit timeline
 *
 * FOOTER: Recent activity
 *   GET /api/v1/head → last chain entry
 *   Auto-refresh every 30s
 */
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const EXPRESS_BASE = process.env.NEXT_PUBLIC_EXPRESS_URL || 'http://localhost:3000';

export default function ChainPage() {
  // ── Chain stats state ────────────────────────────────────────────────────
  const [chainStats, setChainStats]       = useState(null);
  const [chainIntact, setChainIntact]     = useState(null);
  const [statsLoading, setStatsLoading]   = useState(true);

  // ── Mission explorer state ───────────────────────────────────────────────
  const [searchInput, setSearchInput]     = useState('');
  const [mission, setMission]             = useState(null);
  const [missionLoading, setMissionLoading] = useState(false);
  const [missionError, setMissionError]   = useState(null);
  const [aiExpanded, setAiExpanded]       = useState(false);

  // ── Recent activity state ────────────────────────────────────────────────
  const [headEntry, setHeadEntry]         = useState(null);
  const [lastRefresh, setLastRefresh]     = useState(null);
  const refreshTimerRef                   = useRef(null);

  // ── Fetch chain stats + verify ───────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    try {
      const [statsRes, verifyRes] = await Promise.all([
        fetch(`${EXPRESS_BASE}/api/v1/stats`),
        fetch(`${EXPRESS_BASE}/api/v1/verify`),
      ]);
      const statsData  = await statsRes.json();
      const verifyData = await verifyRes.json();
      setChainStats(statsData.chain || null);
      setChainIntact(verifyData.ok ?? null);
    } catch (_) {
      setChainIntact(false);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // ── Fetch head (most recent chain entry) ─────────────────────────────────
  const fetchHead = useCallback(async () => {
    try {
      const res  = await fetch(`${EXPRESS_BASE}/api/v1/head`);
      const data = await res.json();
      setHeadEntry(data);
      setLastRefresh(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (_) {}
  }, []);

  // ── Mission event log state (V97) ───────────────────────────────────────
  const [missionEvents, setMissionEvents]   = useState([]);
  const [eventsLoading, setEventsLoading]   = useState(false);

  // ── Search mission / approval by ID ─────────────────────────────────────
  const searchMission = useCallback(async (id) => {
    if (!id.trim()) return;
    setMissionLoading(true);
    setMissionError(null);
    setMission(null);
    setAiExpanded(false);
    setMissionEvents([]);
    try {
      const [missionRes, eventsRes] = await Promise.all([
        fetch(`${EXPRESS_BASE}/api/v1/mission/${encodeURIComponent(id.trim())}`),
        fetch(`${EXPRESS_BASE}/api/v1/mission/${encodeURIComponent(id.trim())}/events?limit=50`),
      ]);
      const data = await missionRes.json();
      if (!missionRes.ok) throw new Error(data.error || `HTTP ${missionRes.status}`);
      setMission(data);
      // Load event log — gracefully handle missing endpoint
      if (eventsRes.ok) {
        const evData = await eventsRes.json();
        setMissionEvents(evData.events || []);
      }
    } catch (e) {
      setMissionError(e.message);
    } finally {
      setMissionLoading(false);
      setEventsLoading(false);
    }
  }, []);

  // ── Auto-refresh every 30s ───────────────────────────────────────────────
  useEffect(() => {
    fetchStats();
    fetchHead();
    refreshTimerRef.current = setInterval(() => {
      fetchStats();
      fetchHead();
    }, 30000);
    return () => clearInterval(refreshTimerRef.current);
  }, [fetchStats, fetchHead]);

  // ── Derive first resolved approval from mission ──────────────────────────
  const resolvedApproval = mission?.approvals?.find(
    a => a.status !== 'pending' && a.validatorAccountId
  ) || null;

  // Economic split from first billable approval
  const billableApproval = mission?.approvals?.find(
    a => (a.decision === 'approve' || a.decision === 'modify') &&
         Array.isArray(a.ledgerEntries) && a.ledgerEntries.length > 0
  ) || null;
  const priceNum      = parseFloat(billableApproval?.priceUsd || '0');
  const platformAmt   = (priceNum * 0.40).toFixed(4);
  const validatorAmt  = billableApproval ? (priceNum * 0.40).toFixed(4) : '0.0000';
  const insuranceAmt  = (priceNum * 0.20).toFixed(4);

  return (
    <div style={S.root}>

      {/* ══ HEADER: Chain stats bar ══════════════════════════════════════════ */}
      <div style={S.statsBar}>
        <div style={S.statsBarInner}>
          {statsLoading ? (
            <span style={S.dimText}>Loading chain stats…</span>
          ) : (
            <>
              <span style={S.statsBadge}>
                🔗 <strong>{chainStats?.length ?? 0}</strong> entries
              </span>
              <span style={S.statsDivider}>·</span>
              <span style={S.statsBadge}>
                Head: <code style={S.hashCode}>{chainStats?.headHash || '—'}</code>
              </span>
              <span style={S.statsDivider}>·</span>
              <span style={{
                ...S.statsBadge,
                color: chainIntact === true ? '#34d399' : chainIntact === false ? '#f87171' : '#9ca3af',
              }}>
                {chainIntact === true ? '✓ Intact' : chainIntact === false ? '✗ Broken' : '— Unknown'}
              </span>
            </>
          )}
          <span style={{ marginLeft: 'auto', color: '#4b5563', fontSize: 11 }}>
            {lastRefresh ? `Refreshed ${lastRefresh}` : ''}
          </span>
        </div>
      </div>

      <div style={S.body}>

        {/* ══ MAIN: Mission / Approval Explorer ══════════════════════════════ */}
        <section style={S.section}>
          <h2 style={S.sectionTitle}>🔍 Mission Explorer</h2>
          <div style={S.searchRow}>
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchMission(searchInput)}
              style={S.input}
              placeholder="Enter Mission ID or Approval ID (e.g. apv_abc123)"
            />
            <button
              onClick={() => searchMission(searchInput)}
              disabled={missionLoading || !searchInput.trim()}
              style={S.searchBtn}
            >
              {missionLoading ? '…' : '⚡ Search'}
            </button>
          </div>

          {missionError && (
            <div style={S.errorBox}>⚠️ {missionError}</div>
          )}

          {mission && (() => {
            const firstApproval = mission.approvals?.[0] || {};
            const gateVerdict   = mission.summary?.flow === 'AUTO_FLOW' ? 'AUTO_FLOW' : 'HITL_QUEUE';
            const conf          = firstApproval.confidence;
            return (
              <div style={S.missionCard}>
                {/* Mission header */}
                <div style={S.missionHeader}>
                  <span style={S.missionId}>
                    🎯 {mission.missionId}
                  </span>
                  <span style={{
                    ...S.verdictBadge,
                    background: gateVerdict === 'AUTO_FLOW' ? '#064e3b' : '#1e3a5f',
                    color:      gateVerdict === 'AUTO_FLOW' ? '#34d399' : '#93c5fd',
                  }}>
                    {gateVerdict}
                  </span>
                </div>

                {/* Core fields */}
                <div style={S.fieldGrid}>
                  <Field label="Client"     value={firstApproval.clientAccountId || '—'} mono />
                  <Field label="Price"      value={firstApproval.priceUsd ? `$${firstApproval.priceUsd}` : '—'} />
                  <Field label="Confidence" value={conf != null ? `${(conf * 100).toFixed(1)}%` : 'null'} />
                  <Field label="Status"     value={mission.summary?.flow || '—'} />
                </div>

                {/* AI Output — collapsed by default */}
                <div style={S.collapsible}>
                  <button
                    onClick={() => setAiExpanded(x => !x)}
                    style={S.collapseBtn}
                  >
                    🤖 AI Output {aiExpanded ? '▲ collapse' : '▼ expand'}
                  </button>
                  {aiExpanded && (
                    <pre style={S.aiPre}>
                      {JSON.stringify(firstApproval.aiOutput, null, 2) || '—'}
                    </pre>
                  )}
                </div>

                {/* Validator info */}
                {resolvedApproval && (
                  <div style={S.subSection}>
                    <div style={S.subSectionTitle}>👤 Validator Resolution</div>
                    <div style={S.fieldGrid}>
                      <Field label="Validator"  value={resolvedApproval.validatorAccountId} mono />
                      <Field label="Decision"
                        value={resolvedApproval.decision?.toUpperCase() || '—'}
                        color={resolvedApproval.decision === 'approve' ? '#34d399' : '#fbbf24'}
                      />
                      {resolvedApproval.note && (
                        <Field label="Note" value={resolvedApproval.note} span={2} />
                      )}
                    </div>
                  </div>
                )}

                {/* Economic split */}
                {priceNum > 0 && (
                  <div style={S.subSection}>
                    <div style={S.subSectionTitle}>💰 Economic Split (40/40/20)</div>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      {[
                        { role: 'Platform',  amt: platformAmt,  color: '#93c5fd' },
                        { role: 'Validator', amt: validatorAmt, color: '#34d399' },
                        { role: 'Insurance', amt: insuranceAmt, color: '#fcd34d' },
                      ].map(({ role, amt, color }) => (
                        <div key={role} style={S.splitCard}>
                          <div style={{ color, fontSize: 18, fontWeight: 700 }}>${amt}</div>
                          <div style={{ color: '#6b7280', fontSize: 11 }}>{role}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Audit trail */}
                {mission.auditTrail?.length > 0 && (
                  <div style={S.subSection}>
                    <div style={S.subSectionTitle}>📋 Audit Trail ({mission.auditTrail.length} entries)</div>
                    <div style={S.timeline}>
                      {mission.auditTrail.map((entry, i) => (
                        <div key={entry.hash || i} style={S.timelineItem}>
                          <div style={S.timelineDot} />
                          <div style={S.timelineContent}>
                            <span style={S.timelineType}>{entry.type || entry.event || 'UNKNOWN'}</span>
                            <span style={S.timelineTs}>
                              {entry.ts ? new Date(entry.ts).toLocaleTimeString() : '—'}
                            </span>
                            {entry.hash && (
                              <code style={S.timelineHash}>{entry.hash.slice(0, 12)}…</code>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* [V97] Mission event log timeline */}
                {missionEvents.length > 0 && (
                  <div style={S.subSection}>
                    <div style={S.subSectionTitle}>🗂 Event Log ({missionEvents.length} events)</div>
                    <div style={S.timeline}>
                      {missionEvents.map((ev) => (
                        <div key={ev.id} style={S.timelineItem}>
                          <div style={{ ...S.timelineDot, background: '#a78bfa' }} />
                          <div style={S.timelineContent}>
                            <span style={{ ...S.timelineType, color: '#a78bfa' }}>{ev.type}</span>
                            <span style={S.timelineTs}>
                              {ev.ts ? new Date(ev.ts).toLocaleTimeString() : '—'}
                            </span>
                            {ev.actor && (
                              <code style={{ ...S.timelineHash, color: '#6b7280' }}>
                                {ev.actor.length > 24 ? ev.actor.slice(0, 24) + '…' : ev.actor}
                              </code>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </section>

        {/* ══ FOOTER: Recent Activity ═════════════════════════════════════════ */}
        <section style={{ ...S.section, marginTop: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={S.sectionTitle}>⛓ Recent Activity</h2>
            <span style={S.dimText}>Auto-refresh every 30s</span>
          </div>

          {headEntry ? (
            <div style={S.headCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ color: '#9ca3af', fontSize: 11, marginBottom: 4 }}>Latest chain entry</div>
                  <span style={{ ...S.verdictBadge, background: '#1f2937', color: '#e5e7eb' }}>
                    {headEntry.type || 'UNKNOWN'}
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#9ca3af', fontSize: 11 }}>
                    {headEntry.ts ? new Date(headEntry.ts).toLocaleString() : '—'}
                  </div>
                  <div style={{ color: '#4b5563', fontSize: 11, marginTop: 2 }}>
                    Chain length: {headEntry.chainLength ?? '—'}
                  </div>
                </div>
              </div>
              {headEntry.hash && (
                <div style={{ marginTop: 10, borderTop: '1px solid #1f2937', paddingTop: 10 }}>
                  <span style={{ color: '#4b5563', fontSize: 11 }}>Hash: </span>
                  <code style={{ ...S.hashCode, fontSize: 11 }}>{headEntry.hash}</code>
                </div>
              )}
            </div>
          ) : (
            <div style={S.emptyState}>No chain entries yet.</div>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Sub-component: field display ─────────────────────────────────────────────
function Field({ label, value, mono = false, color, span = 1 }) {
  return (
    <div style={{ gridColumn: span > 1 ? `span ${span}` : undefined }}>
      <div style={{ color: '#6b7280', fontSize: 11, marginBottom: 2 }}>{label}</div>
      <div style={{
        color: color || '#e5e7eb',
        fontFamily: mono ? 'monospace' : 'inherit',
        fontSize: mono ? 12 : 14,
        wordBreak: 'break-all',
      }}>
        {String(value)}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  root: {
    background: '#0a0f1a',
    minHeight: '100vh',
    color: '#e5e7eb',
    fontFamily: '"Inter","Segoe UI",system-ui,sans-serif',
  },
  statsBar: {
    background: '#0f172a',
    borderBottom: '1px solid #1f2937',
    padding: '10px 32px',
    position: 'sticky',
    top: 0,
    zIndex: 50,
  },
  statsBarInner: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  statsBadge: {
    fontSize: 13,
    color: '#9ca3af',
  },
  statsDivider: {
    color: '#374151',
    fontSize: 16,
  },
  hashCode: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#60a5fa',
    background: '#1f2937',
    padding: '1px 6px',
    borderRadius: 4,
  },
  dimText: {
    color: '#4b5563',
    fontSize: 12,
  },
  body: {
    padding: '24px 32px',
    maxWidth: 1100,
    margin: '0 auto',
  },
  section: {
    background: '#0f172a',
    border: '1px solid #1f2937',
    borderRadius: 10,
    padding: '20px 24px',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 600,
    margin: '0 0 16px',
    color: '#e5e7eb',
  },
  searchRow: {
    display: 'flex',
    gap: 10,
  },
  input: {
    flex: 1,
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: 6,
    color: '#e5e7eb',
    padding: '8px 14px',
    fontSize: 14,
    outline: 'none',
    fontFamily: 'monospace',
  },
  searchBtn: {
    background: '#1e3a5f',
    border: '1px solid #3b82f6',
    borderRadius: 6,
    color: '#93c5fd',
    padding: '8px 20px',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  errorBox: {
    background: '#7f1d1d',
    border: '1px solid #991b1b',
    borderRadius: 8,
    padding: '10px 14px',
    marginTop: 14,
    color: '#fca5a5',
    fontSize: 13,
  },
  missionCard: {
    marginTop: 20,
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: 8,
    padding: '18px 22px',
  },
  missionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 12,
    flexWrap: 'wrap',
  },
  missionId: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#93c5fd',
    wordBreak: 'break-all',
  },
  verdictBadge: {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.04em',
    whiteSpace: 'nowrap',
  },
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '12px 20px',
    marginBottom: 16,
  },
  collapsible: {
    borderTop: '1px solid #1f2937',
    paddingTop: 12,
    marginBottom: 14,
  },
  collapseBtn: {
    background: 'transparent',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: 13,
    padding: 0,
    marginBottom: 8,
  },
  aiPre: {
    background: '#0a0f1a',
    border: '1px solid #1f2937',
    borderRadius: 6,
    padding: '12px 14px',
    fontSize: 12,
    color: '#34d399',
    overflowX: 'auto',
    maxHeight: 220,
    overflow: 'auto',
    lineHeight: 1.5,
  },
  subSection: {
    borderTop: '1px solid #1f2937',
    paddingTop: 14,
    marginTop: 4,
    marginBottom: 14,
  },
  subSectionTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#9ca3af',
    marginBottom: 10,
  },
  splitCard: {
    background: '#0f172a',
    border: '1px solid #1f2937',
    borderRadius: 8,
    padding: '10px 18px',
    textAlign: 'center',
    minWidth: 110,
  },
  timeline: {
    borderLeft: '2px solid #1f2937',
    paddingLeft: 16,
    marginTop: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  timelineItem: {
    position: 'relative',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
  },
  timelineDot: {
    position: 'absolute',
    left: -21,
    top: 4,
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#3b82f6',
    border: '2px solid #0f172a',
    flexShrink: 0,
  },
  timelineContent: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
    flexWrap: 'wrap',
  },
  timelineType: {
    fontSize: 12,
    fontWeight: 600,
    color: '#60a5fa',
    fontFamily: 'monospace',
  },
  timelineTs: {
    fontSize: 11,
    color: '#6b7280',
  },
  timelineHash: {
    fontSize: 10,
    color: '#374151',
    fontFamily: 'monospace',
  },
  headCard: {
    background: '#111827',
    border: '1px solid #1f2937',
    borderRadius: 8,
    padding: '14px 18px',
    marginTop: 12,
  },
  emptyState: {
    color: '#4b5563',
    fontSize: 13,
    textAlign: 'center',
    padding: '24px 0',
  },
};
