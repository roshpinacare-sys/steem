/**
 * ECOS Reports Page — V154
 * ─────────────────────────────────────────────────────────────────────────────
 * [V154-RPT] Operator Reports — downloadable PDF + inline stats
 *
 * Sections:
 *   1. Report generation — trigger operator report PDF
 *   2. Recent reports list — with download links
 *   3. Platform snapshot — key metrics for the period
 */
'use client';

import { useState, useEffect, useCallback } from 'react';

const EXPRESS_BASE = process.env.NEXT_PUBLIC_EXPRESS_URL || 'http://localhost:3000';

const S = {
  page:    { minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui,sans-serif' },
  header:  { background: '#1e293b', borderBottom: '1px solid #334155', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title:   { fontSize: 20, fontWeight: 700, color: '#f1f5f9', margin: 0 },
  body:    { padding: '24px 32px', maxWidth: 900, margin: '0 auto' },
  section: { background: '#1e293b', borderRadius: 10, padding: 20, marginBottom: 20, border: '1px solid #334155' },
  label:   { fontSize: 14, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 16px 0' },
  btn:     { padding: '10px 20px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  primary: { background: '#1d4ed8', color: '#fff' },
  secondary: { background: '#334155', color: '#cbd5e1' },
  mono:    { fontFamily: 'monospace', fontSize: 12, color: '#a5b4fc' },
  statCard: { background: '#0f172a', borderRadius: 8, padding: '14px 18px', border: '1px solid #334155', flex: 1, minWidth: 160 },
  statVal:  { fontSize: 24, fontWeight: 700, color: '#f1f5f9' },
  statLbl:  { fontSize: 12, color: '#64748b', marginTop: 2 },
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function buildReportFilename(period = 'daily') {
  const d = new Date();
  const stamp = d.toISOString().slice(0, 10).replace(/-/g, '');
  return `ecos_operator_report_${period}_${stamp}.pdf`;
}

export function formatReportPeriod(isoFrom, isoTo) {
  if (!isoFrom || !isoTo) return '—';
  const from = new Date(isoFrom).toLocaleDateString();
  const to   = new Date(isoTo).toLocaleDateString();
  return `${from} → ${to}`;
}

export function reportsListFromLog(log = []) {
  return log.map((entry, i) => ({
    id:        entry.reportId || `rpt-${i}`,
    period:    entry.period   || 'daily',
    createdAt: entry.createdAt || entry.ts || null,
    url:       entry.url || null,
    status:    entry.status || 'ready',
  }));
}

// ── ReportGeneratorSection ────────────────────────────────────────────────────
function ReportGeneratorSection({ onGenerated }) {
  const [period, setPeriod]     = useState('daily');
  const [generating, setGen]    = useState(false);
  const [message, setMsg]       = useState('');

  const generate = async () => {
    setGen(true);
    setMsg('');
    try {
      const r = await fetch(`${EXPRESS_BASE}/api/v1/operator-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period }),
      });
      if (r.ok) {
        const data = await r.json();
        setMsg(`Report generated: ${data.reportId || 'OK'}`);
        onGenerated && onGenerated();
      } else {
        setMsg(`Error generating report (HTTP ${r.status})`);
      }
    } catch (e) {
      setMsg(`Error: ${e.message}`);
    } finally {
      setGen(false);
    }
  };

  return (
    <div style={S.section}>
      <p style={S.label}>Generate Report</p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 }}>Period</label>
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '8px 12px', color: '#e2e8f0', fontSize: 13 }}
          >
            <option value="daily">Daily (last 24h)</option>
            <option value="weekly">Weekly (last 7d)</option>
            <option value="monthly">Monthly (last 30d)</option>
          </select>
        </div>
        <div style={{ paddingTop: 18 }}>
          <button style={{ ...S.btn, ...S.primary }} onClick={generate} disabled={generating}>
            {generating ? 'Generating…' : '📄 Generate PDF Report'}
          </button>
        </div>
      </div>
      {message && (
        <p style={{ fontSize: 13, color: message.startsWith('Error') ? '#f87171' : '#86efac', marginTop: 12 }}>
          {message}
        </p>
      )}
    </div>
  );
}

// ── RecentReportsSection ──────────────────────────────────────────────────────
function RecentReportsSection({ refresh }) {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${EXPRESS_BASE}/api/v1/operator-report/log?limit=10`);
      if (r.ok) {
        const data = await r.json();
        setReports(reportsListFromLog(data.log || data.reports || []));
      }
    } catch (e) { /* non-fatal */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load, refresh]);

  return (
    <div style={S.section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={S.label}>Recent Reports</p>
        <button style={{ ...S.btn, ...S.secondary }} onClick={load}>{loading ? '…' : '↻ Refresh'}</button>
      </div>
      {reports.length === 0 ? (
        <p style={{ color: '#475569', fontSize: 13 }}>No reports generated yet. Create one above.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: '#94a3b8', borderBottom: '1px solid #334155' }}>ID</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: '#94a3b8', borderBottom: '1px solid #334155' }}>Period</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: '#94a3b8', borderBottom: '1px solid #334155' }}>Created</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', color: '#94a3b8', borderBottom: '1px solid #334155' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((rpt, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '8px 12px', ...S.mono }}>{rpt.id}</td>
                <td style={{ padding: '8px 12px', color: '#cbd5e1' }}>{rpt.period}</td>
                <td style={{ padding: '8px 12px', color: '#64748b', fontSize: 12 }}>
                  {rpt.createdAt ? new Date(rpt.createdAt).toLocaleString() : '—'}
                </td>
                <td style={{ padding: '8px 12px' }}>
                  {rpt.url ? (
                    <a href={rpt.url} target="_blank" rel="noreferrer"
                       style={{ color: '#60a5fa', fontSize: 12, textDecoration: 'underline' }}>
                      Download PDF
                    </a>
                  ) : (
                    <span style={{ color: '#475569', fontSize: 12 }}>No file</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Platform Snapshot ─────────────────────────────────────────────────────────
function PlatformSnapshotSection() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    fetch(`${EXPRESS_BASE}/api/v1/admin/stats`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && !d.error && setStats(d))
      .catch(() => {});
  }, []);

  if (!stats) return null;

  const items = [
    { label: 'Validators',      value: stats.validatorCount  ?? '—', color: '#60a5fa' },
    { label: 'Pending Tasks',   value: stats.activeTaskCount ?? '—', color: '#fbbf24' },
    { label: 'Daily Payout',    value: stats.dailyPayoutUsd != null ? `$${parseFloat(stats.dailyPayoutUsd).toFixed(2)}` : '—', color: '#34d399' },
    { label: 'Chain Entries',   value: stats.chainLength     ?? '—', color: stats.chainIntact ? '#34d399' : '#f87171' },
  ];

  return (
    <div style={S.section}>
      <p style={S.label}>Platform Snapshot</p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {items.map((item, i) => (
          <div key={i} style={S.statCard}>
            <div style={{ ...S.statVal, color: item.color }}>{item.value}</div>
            <div style={S.statLbl}>{item.label}</div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11, color: '#475569', marginTop: 12 }}>
        Generated at {new Date().toLocaleString()} · V154
      </p>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div style={S.page}>
      <div style={S.header}>
        <h1 style={S.title}>
          Operator Reports
          <span style={{ fontSize: 13, fontWeight: 400, color: '#64748b', marginLeft: 8 }}>V154</span>
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/admin" style={{ ...S.btn, ...S.secondary, textDecoration: 'none', fontSize: 12 }}>← Admin</a>
          <a href="/"      style={{ ...S.btn, ...S.secondary, textDecoration: 'none', fontSize: 12 }}>← Home</a>
        </div>
      </div>
      <div style={S.body}>
        <PlatformSnapshotSection />
        <ReportGeneratorSection onGenerated={() => setRefreshKey(k => k + 1)} />
        <RecentReportsSection refresh={refreshKey} />
      </div>
    </div>
  );
}
