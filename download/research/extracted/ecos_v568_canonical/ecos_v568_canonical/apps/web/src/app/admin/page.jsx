/**
 * ECOS Admin Dashboard — V155
 * ─────────────────────────────────────────────────────────────────────────────
 * [V155-ADMIN] Upgraded Admin Dashboard — AI Metrics + Real-Time WS Feed
 *
 * New sections vs V154:
 *   10. AI Metrics Dashboard  — confidence histogram, pressure rate, auto-calibration
 *   11. Real-Time Admin Feed  — WebSocket-based audit events (replaces 15s polling)
 *   12. WS Connection Status  — admin WS stats
 *
 * All V154 sections preserved.
 * Sacred files (fiatLedger.js, auditLog.js) are NEVER touched.
 */

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';

const EXPRESS_BASE =
  typeof window !== 'undefined' && window.__ECOS_EXPRESS_URL__
    ? window.__ECOS_EXPRESS_URL__
    : (process.env.NEXT_PUBLIC_EXPRESS_URL || 'http://localhost:3000');

const ADMIN_TOKEN =
  typeof process !== 'undefined' ? (process.env.NEXT_PUBLIC_ADMIN_TOKEN || null) : null;

function apiFetch(path, opts = {}) {
  const token = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('ecos_admin_token') : null;
  return fetch(`${EXPRESS_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
    ...opts,
  });
}

async function fetchJson(path, opts = {}) {
  try {
    const r = await apiFetch(path, opts);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) { return { __error: e.message }; }
}

// ── Pure helpers (unit-tested) ─────────────────────────────────────────────────

export function formatStatValue(n, type = 'number') {
  if (n == null || isNaN(n)) return '—';
  if (type === 'usd')    return '$' + parseFloat(n).toFixed(2);
  if (type === 'percent') return parseFloat(n).toFixed(1) + '%';
  return parseInt(n).toLocaleString();
}

export function classifyHealth(checks = {}) {
  if (!checks.db || !checks.jwtOk) return 'critical';
  const total = Object.keys(checks).length;
  const ok    = Object.values(checks).filter(Boolean).length;
  if (ok === total) return 'healthy';
  if (ok >= Math.ceil(total * 0.6)) return 'degraded';
  return 'critical';
}

export function verdictColor(verdict) {
  switch ((verdict || '').toUpperCase()) {
    case 'AUTO_FLOW':   return '#34d399';
    case 'HITL_QUEUE':  return '#fcd34d';
    case 'BLOCK':       return '#fb923c';
    case 'HARD_REJECT': return '#f87171';
    default:            return '#94a3b8';
  }
}

export function buildPayoutChart(breakdown = []) {
  if (!breakdown.length) return null;
  const max = Math.max(...breakdown.map(b => b.amount), 0.01);
  return breakdown.map(b => ({
    ...b,
    heightPct: Math.round((b.amount / max) * 100),
  }));
}

// ── [V155] AI Metrics helpers (unit-tested) ────────────────────────────────────

export function aiStatusColor(status) {
  switch (status) {
    case 'healthy':  return '#34d399';
    case 'degraded': return '#fbbf24';
    case 'warning':  return '#fb923c';
    default:         return '#94a3b8';
  }
}

export function formatConfidence(v) {
  if (v == null) return '—';
  return (parseFloat(v) * 100).toFixed(1) + '%';
}

export function pressureRateLabel(rate) {
  if (rate == null) return '—';
  const r = parseFloat(rate);
  if (r > 30) return `${r.toFixed(1)}% ⚠️`;
  return `${r.toFixed(1)}%`;
}

// ── Styles ──────────────────────────────────────────────────────────────────
const S = {
  page: { minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui,sans-serif' },
  header: { background: '#1e293b', borderBottom: '1px solid #334155', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 20, fontWeight: 700, color: '#f1f5f9', margin: 0 },
  badge: (c) => ({ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
    background: c === 'ok' ? '#064e3b' : c === 'warn' ? '#78350f' : '#4c0519',
    color: c === 'ok' ? '#6ee7b7' : c === 'warn' ? '#fde68a' : '#fca5a5', marginLeft: 8 }),
  body: { padding: '24px 32px', maxWidth: 1200, margin: '0 auto' },
  section: { background: '#1e293b', borderRadius: 10, padding: 20, marginBottom: 20, border: '1px solid #334155' },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 16px 0' },
  row: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  btn: { padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnPrimary: { background: '#1d4ed8', color: '#fff' },
  btnDanger:  { background: '#7f1d1d', color: '#fca5a5' },
  btnSecondary: { background: '#334155', color: '#cbd5e1' },
  btnSuccess: { background: '#064e3b', color: '#6ee7b7' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 12px', color: '#94a3b8', borderBottom: '1px solid #334155', fontWeight: 600 },
  td: { padding: '8px 12px', borderBottom: '1px solid #1e293b', color: '#e2e8f0' },
  check: (ok) => ({ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: ok ? '#22c55e' : '#ef4444', marginRight: 6 }),
  input: { background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '8px 12px', color: '#e2e8f0', fontSize: 13, width: '100%', boxSizing: 'border-box' },
  label: { display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 },
  mono: { fontFamily: 'monospace', fontSize: 12, color: '#a5b4fc' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  grid4: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 },
  statCard: { background: '#0f172a', borderRadius: 8, padding: '14px 18px', border: '1px solid #334155' },
  statVal: { fontSize: 28, fontWeight: 700, color: '#f1f5f9' },
  statLabel: { fontSize: 12, color: '#64748b', marginTop: 2 },
  liveIndicator: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#22c55e', marginRight: 6, animation: 'pulse 2s infinite' },
};

// ── Auth Gate ─────────────────────────────────────────────────────────────────
function AuthGate({ onAuthed }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const submit = () => {
    if (ADMIN_TOKEN && pw !== ADMIN_TOKEN) { setErr('Wrong token'); return; }
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('ecos_admin_token', pw);
    onAuthed();
  };
  if (!ADMIN_TOKEN) { onAuthed(); return null; }
  return (
    <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#1e293b', borderRadius: 12, padding: 32, width: 340, border: '1px solid #334155' }}>
        <h2 style={{ color: '#f1f5f9', margin: '0 0 20px' }}>Admin Access</h2>
        <label style={S.label}>Admin Token</label>
        <input type="password" style={S.input} value={pw} onChange={e => setPw(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()} placeholder="Enter admin token" />
        {err && <p style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>{err}</p>}
        <button style={{ ...S.btn, ...S.btnPrimary, marginTop: 16, width: '100%' }} onClick={submit}>Enter</button>
      </div>
    </div>
  );
}

// ── [V155] Section: AI Metrics Dashboard ─────────────────────────────────────
function AiMetricsDashboard() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [autoTriggering, setAutoTriggering] = useState(false);
  const [autoMsg, setAutoMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetchJson('/api/v1/admin/ai-metrics');
    setMetrics(d.__error ? null : d);
    setLoading(false);
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const triggerAutoCalib = async () => {
    setAutoTriggering(true);
    const d = await fetchJson('/api/v1/admin/calibrator/auto-trigger', { method: 'POST', body: JSON.stringify({}) });
    if (d.__error) {
      setAutoMsg(`Error: ${d.__error}`);
    } else {
      setAutoMsg(d.triggered
        ? `Auto-calibration triggered! Accuracy was ${(d.calibrationAccuracy * 100).toFixed(1)}% (threshold: ${(d.threshold * 100).toFixed(0)}%)`
        : `No trigger needed — accuracy ${d.calibrationAccuracy != null ? (d.calibrationAccuracy * 100).toFixed(1) + '%' : 'N/A'} is above threshold`
      );
    }
    setAutoTriggering(false);
    setTimeout(() => setAutoMsg(''), 8000);
  };

  const statusColor = metrics ? aiStatusColor(metrics.status) : '#94a3b8';

  return (
    <div style={S.section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={S.sectionTitle}>
          AI Metrics Dashboard
          {metrics && (
            <span style={{ marginLeft: 10, fontSize: 12, color: statusColor, fontWeight: 600 }}>
              ● {metrics.status || 'unknown'}
            </span>
          )}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {loading && <span style={{ fontSize: 11, color: '#64748b' }}>refreshing…</span>}
          <button style={{ ...S.btn, ...S.btnSecondary }} onClick={load}>↻ Refresh</button>
          <button style={{ ...S.btn, ...S.btnPrimary }} onClick={triggerAutoCalib} disabled={autoTriggering}>
            {autoTriggering ? '…' : '⚙ Auto-Calibrate'}
          </button>
        </div>
      </div>

      {autoMsg && (
        <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#86efac' }}>
          {autoMsg}
        </div>
      )}

      {!metrics ? (
        <p style={{ color: '#64748b', fontSize: 13 }}>Loading AI metrics…</p>
      ) : (
        <>
          {/* Summary Cards */}
          <div style={S.grid4}>
            <div style={S.statCard}>
              <div style={{ ...S.statVal, color: '#60a5fa' }}>{metrics.taskCount ?? '—'}</div>
              <div style={S.statLabel}>Tasks in Window ({metrics.windowSize})</div>
            </div>
            <div style={S.statCard}>
              <div style={{ ...S.statVal, color: '#a78bfa' }}>
                {formatConfidence(metrics.avgConfidence)}
              </div>
              <div style={S.statLabel}>Avg Confidence</div>
            </div>
            <div style={S.statCard}>
              <div style={{ ...S.statVal, color: metrics.pressureWarn ? '#fb923c' : '#34d399' }}>
                {pressureRateLabel(metrics.pressureRate)}
              </div>
              <div style={S.statLabel}>Pressure Detection Rate</div>
            </div>
            <div style={S.statCard}>
              <div style={{ ...S.statVal, color: metrics.calibrationAccuracy != null && metrics.calibrationAccuracy < 0.70 ? '#f87171' : '#34d399' }}>
                {metrics.calibrationAccuracy != null ? (metrics.calibrationAccuracy * 100).toFixed(1) + '%' : '—'}
              </div>
              <div style={S.statLabel}>Calibration Accuracy</div>
            </div>
          </div>

          {/* Confidence Histogram */}
          {metrics.histogram && metrics.histogram.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 10px' }}>Confidence Distribution (last {metrics.taskCount} tasks)</p>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }}>
                {metrics.histogram.map((bin, i) => (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div
                      title={`${bin.bin}: ${bin.count} tasks (${bin.pct}%)`}
                      style={{
                        width: '100%',
                        height: bin.count > 0 ? Math.max(4, (bin.pct / 100) * 70) : 2,
                        background: bin.low >= 0.7 ? '#34d399' : bin.low >= 0.5 ? '#fbbf24' : bin.low >= 0.3 ? '#fb923c' : '#f87171',
                        borderRadius: '3px 3px 0 0',
                        transition: 'height 0.3s',
                        cursor: 'default',
                      }}
                    />
                    <span style={{ fontSize: 9, color: '#475569', marginTop: 3 }}>{bin.low * 100 | 0}%</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
                {[
                  { color: '#34d399', label: '≥70% (AUTO_FLOW zone)' },
                  { color: '#fbbf24', label: '50–70% (HITL zone)' },
                  { color: '#fb923c', label: '30–50% (BLOCK zone)' },
                  { color: '#f87171', label: '<30% (HARD_REJECT zone)' },
                ].map(({ color, label }) => (
                  <span key={label} style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: color }} />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Verdict Distribution */}
          {metrics.verdictCounts && Object.keys(metrics.verdictCounts).length > 0 && (
            <div style={{ marginTop: 16 }}>
              <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 8px' }}>Verdict Distribution</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {Object.entries(metrics.verdictCounts).map(([verdict, count]) => (
                  <span key={verdict} style={{
                    background: '#0f172a', border: `1px solid ${verdictColor(verdict)}`,
                    padding: '4px 12px', borderRadius: 20, fontSize: 12,
                    color: verdictColor(verdict), fontWeight: 600,
                  }}>
                    {verdict}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Auto-calibration info */}
          {metrics.autoCalibCount > 0 && (
            <div style={{ marginTop: 16, background: '#0f172a', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#94a3b8' }}>
              Auto-calibration fired <strong style={{ color: '#fbbf24' }}>{metrics.autoCalibCount}</strong> time(s).
              Last: <span style={S.mono}>{metrics.lastAutoCalib || '—'}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── [V155] Section: Real-Time Admin WS Feed ───────────────────────────────────
function RealTimeAdminFeed() {
  const [events, setEvents] = useState([]);
  const [wsStatus, setWsStatus] = useState('disconnected'); // connected | disconnected | error
  const [fallbackPolling, setFallbackPolling] = useState(false);
  const wsRef = useRef(null);
  const MAX_EVENTS = 20;

  const addEvent = useCallback((event) => {
    setEvents(prev => [event, ...prev].slice(0, MAX_EVENTS));
  }, []);

  // Fallback: poll /api/v1/admin/events if WS fails
  const pollFallback = useCallback(async () => {
    const d = await fetchJson('/api/v1/admin/events?limit=10');
    if (!d.__error && d.events) {
      setEvents(d.events.slice(0, MAX_EVENTS));
    }
  }, []);

  useEffect(() => {
    let ws = null;
    let reconnectTimer = null;

    const connect = () => {
      try {
        const wsBase = EXPRESS_BASE.replace(/^http/, 'ws');
        const token = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('ecos_admin_token') : null;
        const url = `${wsBase}/ws/admin${token ? `?adminToken=${token}` : ''}`;
        ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          setWsStatus('connected');
          setFallbackPolling(false);
        };

        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'audit.event') {
              addEvent({ ...msg.data, _source: 'ws', _ts: msg.ts });
            }
          } catch (_) {}
        };

        ws.onerror = () => setWsStatus('error');

        ws.onclose = () => {
          setWsStatus('disconnected');
          setFallbackPolling(true);
          // Reconnect after 5s
          reconnectTimer = setTimeout(connect, 5000);
        };
      } catch (_) {
        setWsStatus('error');
        setFallbackPolling(true);
      }
    };

    connect();

    return () => {
      if (ws) { try { ws.close(); } catch (_) {} }
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [addEvent]);

  // Fallback polling when WS is unavailable
  useEffect(() => {
    if (!fallbackPolling) return;
    pollFallback();
    const t = setInterval(pollFallback, 15000);
    return () => clearInterval(t);
  }, [fallbackPolling, pollFallback]);

  const timeAgo = (ts) => {
    if (!ts) return '—';
    const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60)   return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    return `${Math.floor(s/3600)}h ago`;
  };

  const wsStatusColor = wsStatus === 'connected' ? '#22c55e' : wsStatus === 'error' ? '#ef4444' : '#94a3b8';

  return (
    <div style={S.section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={S.sectionTitle}>
          Real-Time Audit Feed
          <span style={{ marginLeft: 10, fontSize: 11, color: wsStatusColor, fontWeight: 600 }}>
            {wsStatus === 'connected' ? (
              <><span style={S.liveIndicator} />LIVE</>
            ) : wsStatus === 'error' ? '● ERROR' : '● POLLING'}
          </span>
        </p>
        <button style={{ ...S.btn, ...S.btnSecondary }} onClick={pollFallback}>↻ Refresh</button>
      </div>
      {events.length === 0 ? (
        <p style={{ color: '#64748b', fontSize: 13 }}>
          {wsStatus === 'connected' ? 'Waiting for audit events…' : 'No audit events yet.'}
        </p>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Type</th>
              <th style={S.th}>Mission</th>
              <th style={S.th}>Verdict</th>
              <th style={S.th}>When</th>
              <th style={S.th}>Source</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e, i) => (
              <tr key={i} style={{ opacity: i === 0 ? 1 : 0.85 }}>
                <td style={S.td}><span style={{ color: '#a5b4fc', fontWeight: 600 }}>{e.type || '?'}</span></td>
                <td style={{ ...S.td, ...S.mono }}>{e.missionId ? String(e.missionId).slice(0, 12) : '—'}</td>
                <td style={S.td}>
                  {e.verdict
                    ? <span style={{ color: verdictColor(e.verdict), fontWeight: 600 }}>{e.verdict}</span>
                    : <span style={{ color: '#475569' }}>—</span>}
                </td>
                <td style={{ ...S.td, color: '#64748b', fontSize: 12 }}>{timeAgo(e.ts || e._ts)}</td>
                <td style={{ ...S.td, fontSize: 11, color: e._source === 'ws' ? '#22c55e' : '#64748b' }}>
                  {e._source === 'ws' ? '⚡ WS' : '🔄 poll'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── [V155] Section: WS Connection Status ─────────────────────────────────────
function WsStatusSection() {
  const [data, setData] = useState(null);
  const load = useCallback(async () => { setData(await fetchJson('/api/v1/admin/ws/stats')); }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  return (
    <div style={S.section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={S.sectionTitle}>WebSocket Connections</p>
        <button style={{ ...S.btn, ...S.btnSecondary }} onClick={load}>↻</button>
      </div>
      {!data || data.__error ? (
        <p style={{ color: '#64748b', fontSize: 13 }}>Loading WS stats…</p>
      ) : (
        <div style={S.grid2}>
          <div style={S.statCard}>
            <div style={{ ...S.statVal, color: '#60a5fa' }}>
              {data.adminWs?.connectedClients ?? '—'}
            </div>
            <div style={S.statLabel}>Admin WS Clients (/ws/admin)</div>
          </div>
          <div style={S.statCard}>
            <div style={{ ...S.statVal, color: '#a78bfa' }}>
              {data.notificationWs?.connectedUsers ?? '—'}
            </div>
            <div style={S.statLabel}>Notification WS Users (/ws/notifications)</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── [V154] Section: Platform Stats ───────────────────────────────────────────
function PlatformStatsSection() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetchJson('/api/v1/admin/stats');
    setStats(d.__error ? null : d);
    setLoading(false);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const healthColor = stats ? (stats.chainIntact ? '#34d399' : '#f87171') : '#94a3b8';

  return (
    <div style={S.section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={S.sectionTitle}>Platform Stats — Live</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {loading && <span style={{ fontSize: 11, color: '#64748b' }}>refreshing…</span>}
          <button style={{ ...S.btn, ...S.btnSecondary }} onClick={load}>↻ Refresh</button>
        </div>
      </div>
      {!stats ? (
        <p style={{ color: '#64748b', fontSize: 13 }}>Loading platform stats…</p>
      ) : (
        <div style={S.grid4}>
          <div style={S.statCard}>
            <div style={{ ...S.statVal, color: '#60a5fa' }}>{stats.validatorCount ?? '—'}</div>
            <div style={S.statLabel}>Active Validators</div>
          </div>
          <div style={S.statCard}>
            <div style={{ ...S.statVal, color: '#fbbf24' }}>{stats.activeTaskCount ?? '—'}</div>
            <div style={S.statLabel}>Pending Tasks</div>
          </div>
          <div style={S.statCard}>
            <div style={{ ...S.statVal, color: '#34d399' }}>
              ${parseFloat(stats.dailyPayoutUsd || 0).toFixed(2)}
            </div>
            <div style={S.statLabel}>Daily Payout (24h)</div>
          </div>
          <div style={S.statCard}>
            <div style={{ ...S.statVal, color: healthColor }}>
              {stats.chainLength ?? '—'}
            </div>
            <div style={S.statLabel}>Chain Entries {stats.chainIntact ? '✅' : '⚠️'}</div>
          </div>
        </div>
      )}
      {stats?.rankStats?.total > 0 && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 8px' }}>Rank Distribution</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(stats.rankStats.byTier || {}).map(([tier, count]) => (
              <span key={tier} style={{ background: '#334155', padding: '4px 10px', borderRadius: 20, fontSize: 12, color: '#cbd5e1' }}>
                {tier}: {count}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── [V154] Section: Daily Payout Bar Chart ────────────────────────────────────
function DailyPayoutChartSection() {
  const [data, setData] = useState([]);
  const load = useCallback(async () => {
    const d = await fetchJson('/api/v1/admin/payouts/daily');
    setData(d.breakdown || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const chart = buildPayoutChart(data);
  const totalDay = data.reduce((s, b) => s + b.amount, 0);

  return (
    <div style={S.section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={S.sectionTitle}>Daily Payout Distribution (24h)</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: '#34d399', fontWeight: 600 }}>
            Total: ${totalDay.toFixed(2)}
          </span>
          <button style={{ ...S.btn, ...S.btnSecondary }} onClick={load}>↻</button>
        </div>
      </div>
      {!chart || chart.every(b => b.amount === 0) ? (
        <p style={{ color: '#64748b', fontSize: 13 }}>No payouts in the last 24 hours.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80, minWidth: 600 }}>
            {chart.map((b, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div
                  title={`${b.hour}: $${b.amount.toFixed(4)}`}
                  style={{
                    width: '100%',
                    height: b.amount > 0 ? Math.max(4, b.heightPct * 0.7) : 2,
                    background: b.amount > 0 ? '#3b82f6' : '#1e293b',
                    borderRadius: '2px 2px 0 0',
                    transition: 'height 0.3s',
                  }}
                />
                {i % 4 === 0 && (
                  <span style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>
                    {b.hour.split(':')[0]}h
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── [V148] Section: System Readiness ─────────────────────────────────────────
function ReadinessSection() {
  const [data, setData] = useState(null);
  const load = useCallback(async () => { setData(await fetchJson('/api/v1/system/readiness')); }, []);
  useEffect(() => { load(); }, [load]);

  const checks = data?.checks || {};
  const items = [
    { key: 'db',      label: 'Database (Postgres)',    req: true },
    { key: 'stripe',  label: 'Stripe API Key',         req: false },
    { key: 'smtp',    label: 'Email (Resend/SMTP)',     req: false },
    { key: 'jwtOk',   label: 'JWT Secret (≥32 chars)', req: true },
    { key: 'baseUrl', label: 'ECOS Base URL',           req: false },
    { key: 'adminWs', label: 'Admin WS Hub',            req: false },
  ];

  return (
    <div style={S.section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={S.sectionTitle}>System Readiness — V155</p>
        <button style={{ ...S.btn, ...S.btnSecondary }} onClick={load}>↻ Refresh</button>
      </div>
      {!data ? <p style={{ color: '#64748b' }}>Loading…</p> : (
        <>
          <div style={{ marginBottom: 16 }}>
            <span style={S.badge(data.ok ? 'ok' : 'error')}>{data.ok ? '✅ Deploy Ready' : '❌ Not Ready'}</span>
            <span style={{ color: '#64748b', fontSize: 13, marginLeft: 12 }}>Score: {data.score}/{data.max}</span>
          </div>
          <table style={S.table}>
            <thead><tr><th style={S.th}>Check</th><th style={S.th}>Status</th><th style={S.th}>Required</th></tr></thead>
            <tbody>
              {items.map(item => (
                <tr key={item.key}>
                  <td style={S.td}>{item.label}</td>
                  <td style={S.td}><span style={S.check(checks[item.key])} />{checks[item.key] ? 'OK' : 'Missing'}</td>
                  <td style={S.td}><span style={S.badge(item.req ? (checks[item.key] ? 'ok' : 'error') : 'warn')}>{item.req ? 'Required' : 'Optional'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: '#475569', marginTop: 12 }}>
            Run <span style={S.mono}>node scripts/pre-deploy-check.js</span> for full local validation.
          </p>
        </>
      )}
    </div>
  );
}

// ── [V148] Accounts, Validators, Controls (preserved) ────────────────────────
function AccountsSection() {
  const [accounts, setAccounts] = useState([]);
  const load = useCallback(async () => {
    const d = await fetchJson('/api/v1/account/all');
    setAccounts(d.__error ? [] : (Array.isArray(d) ? d : d.accounts || []));
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div style={S.section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={S.sectionTitle}>All Accounts</p>
        <button style={{ ...S.btn, ...S.btnSecondary }} onClick={load}>↻ Refresh</button>
      </div>
      {accounts.length === 0 ? <p style={{ color: '#64748b', fontSize: 13 }}>No accounts yet.</p> : (
        <table style={S.table}>
          <thead><tr><th style={S.th}>Account ID</th><th style={S.th}>Balance</th><th style={S.th}>Type</th></tr></thead>
          <tbody>{accounts.map((a,i) => (
            <tr key={i}>
              <td style={{ ...S.td, ...S.mono }}>{a.id || a.accountId || '—'}</td>
              <td style={{ ...S.td, color: '#34d399' }}>{a.balance || a.balanceDisplay || '—'}</td>
              <td style={S.td}>{a.type || 'account'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

function ValidatorStatusSection() {
  const [validators, setValidators] = useState([]);
  const load = useCallback(async () => {
    const d = await fetchJson('/api/v1/validators');
    setValidators(d.__error ? [] : (Array.isArray(d) ? d : d.validators || []));
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div style={S.section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={S.sectionTitle}>Validator Status</p>
        <button style={{ ...S.btn, ...S.btnSecondary }} onClick={load}>↻ Refresh</button>
      </div>
      {validators.length === 0 ? <p style={{ color: '#64748b', fontSize: 13 }}>No validators yet.</p> : (
        <table style={S.table}>
          <thead><tr>
            <th style={S.th}>Validator ID</th><th style={S.th}>Rank</th>
            <th style={S.th}>Stripe Connect</th><th style={S.th}>Completed</th><th style={S.th}>Earnings</th>
          </tr></thead>
          <tbody>{validators.map((v,i) => (
            <tr key={i}>
              <td style={{ ...S.td, ...S.mono }}>{(v.id||v.validatorId||'').slice(0,18)}…</td>
              <td style={S.td}><span style={S.badge('ok')}>{v.tier||v.rank||'—'}</span></td>
              <td style={S.td}><span style={S.check(v.stripeOnboarded||v.payoutsEnabled)} />{v.stripeOnboarded||v.payoutsEnabled ? 'Onboarded' : v.stripeStatus||'Not started'}</td>
              <td style={S.td}>{v.completedTasks??v.validationsCompleted??'—'}</td>
              <td style={{ ...S.td, color: '#34d399' }}>{v.totalEarned||v.earnings||'—'}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

function ControlsSection() {
  const [calibrating, setCalibrating] = useState(false);
  const [chainHead, setChainHead]     = useState(null);
  const [calMsg, setCalMsg]           = useState('');
  const runCalibrator = async () => {
    setCalibrating(true);
    const d = await fetchJson('/api/v1/calibrator/run', { method: 'POST', body: JSON.stringify({}) });
    setCalMsg(d.__error ? `Error: ${d.__error}` : `Calibrated: threshold ${d.newThreshold ?? '—'}`);
    setCalibrating(false);
  };
  return (
    <div style={S.section}>
      <p style={S.sectionTitle}>System Controls</p>
      <div style={S.row}>
        <button style={{ ...S.btn, ...S.btnPrimary }} onClick={runCalibrator} disabled={calibrating}>
          {calibrating ? 'Calibrating…' : '⚙ Run Calibrator'}
        </button>
        <button style={{ ...S.btn, ...S.btnSecondary }} onClick={async () => setChainHead(await fetchJson('/api/v1/chain/proof'))}>
          🔗 Fetch Chain Head
        </button>
      </div>
      {calMsg && <p style={{ fontSize: 13, color: '#86efac', marginTop: 12 }}>{calMsg}</p>}
      {chainHead && !chainHead.__error && (
        <div style={{ marginTop: 16, background: '#0f172a', borderRadius: 8, padding: 14 }}>
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 6px' }}>Chain Head</p>
          <p style={{ ...S.mono, margin: 0 }}>Hash: {chainHead.headHash||chainHead.hash||'—'}</p>
          <p style={{ ...S.mono, margin: '4px 0 0' }}>Intact: {chainHead.intact ? '✅' : '❌'}</p>
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  if (!authed) return <AuthGate onAuthed={() => setAuthed(true)} />;

  return (
    <div style={S.page}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      <div style={S.header}>
        <h1 style={S.title}>
          ECOS Admin Dashboard
          <span style={{ fontSize: 13, fontWeight: 400, color: '#64748b', marginLeft: 8 }}>V155</span>
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/workspace"  style={{ ...S.btn, ...S.btnSuccess, textDecoration: 'none', fontSize: 12 }}>🗂 Workspaces</a>
          <a href="/reports"    style={{ ...S.btn, ...S.btnSecondary, textDecoration: 'none', fontSize: 12 }}>📄 Reports</a>
          <a href="/"           style={{ ...S.btn, ...S.btnSecondary, textDecoration: 'none', fontSize: 12 }}>← Home</a>
        </div>
      </div>
      <div style={S.body}>
        {/* V155 New Sections */}
        <AiMetricsDashboard />
        <RealTimeAdminFeed />
        <WsStatusSection />
        {/* V154 Preserved Sections */}
        <PlatformStatsSection />
        <DailyPayoutChartSection />
        <ReadinessSection />
        <ControlsSection />
        <AccountsSection />
        <ValidatorStatusSection />
      </div>
    </div>
  );
}
