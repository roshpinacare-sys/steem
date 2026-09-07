'use client';
/**
 * Sovereign AI Dashboard — ECOS V132
 * ─────────────────────────────────────────────────────────────────────────────
 * Real-time dashboard for the Sovereign AI-on-Chain system.
 *
 * Sections:
 *   1. Chain Status — audit chain integrity + MMR root
 *   2. Inference Feed — live stats from /api/v1/sovereign/stats
 *   3. Consensus Status — latest consensus runs from /api/v1/inference/consensus/stats
 *   4. Translation Proofs — recent translation attestations
 *
 * Supports RTL (Hebrew/Arabic). Dark theme. Auto-refreshes every 30s.
 *
 * [V132-AVC-02]
 */

import { useEffect, useState, useCallback, useReducer } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ── RTL support ───────────────────────────────────────────────────────────────

const RTL_LANGS = ['he', 'ar', 'fa', 'ur'];
function isRTL(lang = '') { return RTL_LANGS.some(l => lang.startsWith(l)); }
function detectDir() {
  if (typeof document === 'undefined') return 'ltr';
  return isRTL(document.documentElement.lang) ? 'rtl' : 'ltr';
}

// ── helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)   return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtPct(n) {
  if (n === null || n === undefined) return '—';
  return `${Math.round(n * 100)}%`;
}

function fmtConf(n) {
  if (n === null || n === undefined) return '—';
  return n.toFixed(3);
}

function shortHash(h) {
  if (!h) return '—';
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

// ── Data fetching hooks ───────────────────────────────────────────────────────

function useSovereignStats(refreshMs = 30000) {
  const [data,      setData]      = useState(null);
  const [audit,     setAudit]     = useState(null);
  const [consensus, setConsensus] = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [lastUpdate,setLastUpdate]= useState(null);
  const [tick, refresh] = useReducer(n => n + 1, 0);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, auditRes, cnsRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/sovereign/stats`).catch(() => null),
        fetch(`${API_BASE}/api/v1/sovereign/audit`).catch(() => null),
        fetch(`${API_BASE}/api/v1/inference/consensus/stats`).catch(() => null),
      ]);

      if (statsRes?.ok) setData(await statsRes.json());
      if (auditRes?.ok) setAudit(await auditRes.json());
      if (cnsRes?.ok)   setConsensus(await cnsRes.json());

      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setLastUpdate(new Date().toISOString());
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, tick]);
  useEffect(() => {
    const id = setInterval(() => refresh(), refreshMs);
    return () => clearInterval(id);
  }, [refreshMs]);

  return { data, audit, consensus, loading, error, lastUpdate, refresh };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, accent = '#3b82f6', mono = false }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: accent, fontFamily: mono ? 'monospace' : 'inherit', lineHeight: 1.1 }}>
        {value ?? '—'}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{sub}</div>
      )}
    </div>
  );
}

function StatusBadge({ ok, label }) {
  return (
    <span style={{
      display:      'inline-flex',
      alignItems:   'center',
      gap:          5,
      padding:      '3px 10px',
      borderRadius: 99,
      fontSize:     12,
      fontWeight:   600,
      background:   ok ? '#14532d' : '#7f1d1d',
      color:        ok ? '#4ade80' : '#f87171',
    }}>
      <span style={{ fontSize: 8 }}>{ok ? '●' : '●'}</span>
      {label}
    </span>
  );
}

function SectionHeader({ title, icon }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: '#e5e7eb', margin: 0 }}>{title}</h2>
    </div>
  );
}

function ProviderBar({ providerUsage = {} }) {
  const entries = Object.entries(providerUsage).sort(([, a], [, b]) => b - a);
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (entries.length === 0) return <div style={{ color: '#6b7280', fontSize: 13 }}>No provider data yet</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {entries.map(([id, count]) => {
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <div key={id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#9ca3af', marginBottom: 3 }}>
              <span style={{ fontFamily: 'monospace' }}>{id}</span>
              <span>{count} calls ({pct}%)</span>
            </div>
            <div style={{ background: '#1f2937', borderRadius: 3, height: 6, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: '#3b82f6', borderRadius: 3, transition: 'width 0.4s ease' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InferenceFeed({ data }) {
  if (!data) return <EmptyState message="Connecting to inference chain…" />;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
      <MetricCard label="Total Inferences"   value={data.totalInferences}   accent="#3b82f6" />
      <MetricCard label="Avg Confidence"     value={fmtConf(data.avgConfidence)} accent="#8b5cf6" sub="calibrated" />
      <MetricCard label="Total Translations" value={data.totalTranslations}  accent="#06b6d4" />
      <MetricCard label="MMR Root"           value={shortHash(data.mmrRoot)} accent="#f59e0b" mono sub="inclusion proof" />
    </div>
  );
}

function AuditPanel({ audit }) {
  if (!audit) return <EmptyState message="Loading chain audit…" />;
  const intact = audit.intact !== false;
  return (
    <div style={panelStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <StatusBadge ok={intact} label={intact ? 'Chain Intact' : 'Chain Broken'} />
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          {audit.entriesChecked ?? 0} entries verified
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <div style={auditLabelStyle}>Head Hash</div>
          <div style={hashStyle}>{shortHash(audit.headHash)}</div>
        </div>
        <div>
          <div style={auditLabelStyle}>Tail Hash</div>
          <div style={hashStyle}>{shortHash(audit.tailHash)}</div>
        </div>
        {audit.brokenAt && (
          <div style={{ gridColumn: '1/-1' }}>
            <div style={auditLabelStyle}>⚠️ Break detected at</div>
            <div style={{ ...hashStyle, color: '#f87171' }}>{audit.brokenAt}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function ConsensusPanel({ consensus }) {
  if (!consensus) return <EmptyState message="No consensus data yet" />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
        <MetricCard label="Total Runs"      value={consensus.totalRuns}                 accent="#3b82f6" />
        <MetricCard label="Dissent Runs"    value={consensus.dissentRuns}               accent="#f59e0b" sub="providers disagreed" />
        <MetricCard label="Avg Quorum"      value={fmtPct(consensus.avgQuorum)}         accent="#10b981" />
        <MetricCard label="Avg Confidence"  value={fmtConf(consensus.avgConfidence)}    accent="#8b5cf6" />
      </div>
      {consensus.providerUsage && Object.keys(consensus.providerUsage).length > 0 && (
        <div style={panelStyle}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#9ca3af', marginBottom: 12 }}>Provider Usage</div>
          <ProviderBar providerUsage={consensus.providerUsage} />
        </div>
      )}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div style={{ color: '#6b7280', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>
      {message}
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
      <div style={{ width: 32, height: 32, border: '3px solid #1f2937', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SovereignPage() {
  const dir = detectDir();
  const { data, audit, consensus, loading, error, lastUpdate, refresh } = useSovereignStats(30000);

  return (
    <div style={{ ...pageStyle, direction: dir }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={headerStyle}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>⛓️</span>
            <h1 style={titleStyle}>Sovereign AI Dashboard</h1>
          </div>
          <p style={subtitleStyle}>
            Every inference signed · Every translation attested · Every proof verifiable
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: dir === 'rtl' ? 'flex-start' : 'flex-end', gap: 8 }}>
          {audit && (
            <StatusBadge
              ok={audit.intact !== false}
              label={audit.intact !== false ? '✓ Chain Intact' : '⚠ Chain Broken'}
            />
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {lastUpdate && (
              <span style={{ fontSize: 12, color: '#6b7280' }}>
                <span style={{ color: '#22c55e' }}>●</span> {timeAgo(lastUpdate)}
              </span>
            )}
            <button onClick={refresh} style={refreshBtnStyle} title="Refresh now">
              ↻ Refresh
            </button>
          </div>
        </div>
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────── */}
      {error && (
        <div style={errorBannerStyle}>
          ⚠️ {error} — data may be stale
        </div>
      )}

      {loading && !data && !audit ? (
        <LoadingSpinner />
      ) : (
        <div style={contentStyle}>

          {/* ── Section 1: Chain Status ──────────────────────────────────── */}
          <section style={sectionStyle}>
            <SectionHeader title="Chain Status" icon="🔐" />
            <AuditPanel audit={audit} />
          </section>

          {/* ── Section 2: Inference Feed ────────────────────────────────── */}
          <section style={sectionStyle}>
            <SectionHeader title="Inference Chain" icon="🧠" />
            <InferenceFeed data={data} />
          </section>

          {/* ── Section 3: Consensus ─────────────────────────────────────── */}
          <section style={sectionStyle}>
            <SectionHeader title="Multi-Provider Consensus" icon="🗳️" />
            <ConsensusPanel consensus={consensus} />
          </section>

          {/* ── Section 4: Translation Proofs ────────────────────────────── */}
          <section style={sectionStyle}>
            <SectionHeader title="Translation Proofs" icon="🌐" />
            {data ? (
              <div style={panelStyle}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                  <MetricCard
                    label="Signed Translations"
                    value={data.totalTranslations ?? 0}
                    accent="#06b6d4"
                    sub="attested to chain"
                  />
                  <MetricCard
                    label="MMR Root"
                    value={shortHash(data.mmrRoot)}
                    accent="#f59e0b"
                    mono
                    sub="inclusion proof anchor"
                  />
                  <MetricCard
                    label="Total Inferences"
                    value={data.totalInferences ?? 0}
                    accent="#3b82f6"
                    sub="logged to chain"
                  />
                </div>
                <div style={{ marginTop: 16, padding: 12, background: '#0f172a', borderRadius: 8, fontSize: 12, color: '#6b7280', lineHeight: 1.6 }}>
                  <span style={{ color: '#4ade80' }}>✓</span> All translations are privacy-preserving:
                  only <code style={codeStyle}>sha256(source)</code> and <code style={codeStyle}>sha256(output)</code> are stored on-chain —
                  never the raw text.
                  Verify any translation via <code style={codeStyle}>POST /api/v1/language/verify-translation</code>.
                </div>
              </div>
            ) : (
              <EmptyState message="Connecting to translation layer…" />
            )}
          </section>

          {/* ── [V133-PH-02] Consensus Form ─────────────────────────────── */}
          <section style={sectionStyle}>
            <ConsensusForm apiBase={API_BASE} />
          </section>

        </div>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div style={footerStyle}>
        ECOS Sovereign AI-on-Chain · V133 · Auto-refreshes every 30s
        {lastUpdate && <> · Last updated {timeAgo(lastUpdate)}</>}
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const pageStyle = {
  minHeight:  'calc(100vh - 56px)',
  background: '#0f172a',
  overflowY:  'auto',
  display:    'flex',
  flexDirection: 'column',
};

const headerStyle = {
  display:        'flex',
  alignItems:     'flex-start',
  justifyContent: 'space-between',
  padding:        '32px 40px 0',
  flexWrap:       'wrap',
  gap:            16,
};

const titleStyle = {
  fontSize:   24,
  fontWeight: 800,
  color:      '#e5e7eb',
  margin:     0,
};

const subtitleStyle = {
  fontSize:   13,
  color:      '#6b7280',
  marginTop:  4,
};

const contentStyle = {
  flex:    1,
  padding: '24px 40px 32px',
  display: 'flex',
  flexDirection: 'column',
  gap:     32,
};

const sectionStyle = {
  borderBottom: '1px solid #1f2937',
  paddingBottom: 28,
};

const panelStyle = {
  background:   '#111827',
  border:       '1px solid #1f2937',
  borderRadius: 10,
  padding:      '16px 20px',
};

const cardStyle = {
  background:   '#111827',
  border:       '1px solid #1f2937',
  borderRadius: 10,
  padding:      '14px 18px',
};

const auditLabelStyle = {
  fontSize:   11,
  color:      '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 3,
};

const hashStyle = {
  fontFamily: 'monospace',
  fontSize:   13,
  color:      '#e5e7eb',
};

const codeStyle = {
  fontFamily:  'monospace',
  fontSize:    11,
  color:       '#60a5fa',
  background:  '#1f2937',
  padding:     '1px 4px',
  borderRadius: 3,
};

const errorBannerStyle = {
  margin:       '16px 40px 0',
  padding:      '10px 16px',
  background:   '#7f1d1d',
  color:        '#fca5a5',
  borderRadius: 8,
  fontSize:     13,
};

const refreshBtnStyle = {
  padding:      '5px 14px',
  borderRadius: 6,
  border:       '1px solid #374151',
  background:   '#1f2937',
  color:        '#9ca3af',
  cursor:       'pointer',
  fontSize:     13,
  fontWeight:   500,
};

const footerStyle = {
  padding:    '12px 40px',
  fontSize:   12,
  color:      '#374151',
  borderTop:  '1px solid #1f2937',
  marginTop:  'auto',
};
