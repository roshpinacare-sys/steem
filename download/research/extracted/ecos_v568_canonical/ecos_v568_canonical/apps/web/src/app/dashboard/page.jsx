/**
 * ECOS System Dashboard — V75
 * ─────────────────────────────────────────────────────────────────────────────
 * "Pulse of the world" — live overview of the entire system.
 * Auto-refreshes every 10 seconds + SSE live feed.
 *
 * Layout: three sections
 *   TOP:    System Health (4 cards: Chain, Calibrator, Queue, Server)
 *   LEFT:   Activity Feed (60%, scrollable, 50 items max)
 *   RIGHT:  Stats Sidebar (40%, totals + bar chart)
 *
 * Dark theme, same as existing pages.
 * [V75] GET /api/v1/stats wired into the 4 health cards.
 */

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

const EXPRESS_BASE =
  typeof window !== 'undefined' && window.__ECOS_EXPRESS_URL__
    ? window.__ECOS_EXPRESS_URL__
    : (process.env.NEXT_PUBLIC_EXPRESS_URL || 'http://localhost:3000');

// ── Health Card Component ─────────────────────────────────────────────────────
function HealthCard({ icon, label, value, status, detail, color }) {
  const bgColor = status === 'good' ? '#064e3b' : status === 'warning' ? '#78350f' : '#374151';
  const textColor = color || (status === 'good' ? '#34d399' : status === 'warning' ? '#fcd34d' : '#9ca3af');

  return (
    <div style={{
      background: bgColor,
      border: `1px solid ${textColor}`,
      borderRadius: 8,
      padding: 16,
      flex: 1,
      minWidth: 200,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 14, color: '#9ca3af', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: textColor, marginBottom: 4 }}>{value}</div>
      {detail && <div style={{ fontSize: 12, color: '#6b7280' }}>{detail}</div>}
    </div>
  );
}

// ── Activity Feed Item Component ──────────────────────────────────────────────
function ActivityItem({ approval, expanded, onToggle, isLive }) {
  const timeAgo = (iso) => {
    if (!iso) return '—';
    const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const verdictColor = (v) => {
    if (!v) return '#9ca3af';
    switch (v.toUpperCase()) {
      case 'AUTO_FLOW': return '#34d399';
      case 'HITL_QUEUE': return '#fcd34d';
      case 'HARD_REJECT': return '#fca5a5';
      default: return '#93c5fd';
    }
  };

  const verdict = approval.verdict || approval.status || '?';
  const missionLookupId = approval.missionId || approval.id || approval.approvalId || '';
  const missionId = String(missionLookupId).substring(0, 12);
  const amount = approval.priceUsd || '0.00';
  const time = timeAgo(approval.createdAt);

  return (
    <div
      onClick={onToggle}
      style={{
        background: '#1f2937',
        border: isLive ? '1px solid #22c55e' : '1px solid #374151',
        borderRadius: 8,
        padding: 12,
        marginBottom: 8,
        cursor: 'pointer',
        transition: 'all 0.2s',
        animation: 'fadeIn 0.3s ease-in',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: expanded ? 12 : 0 }}>
        <div style={{ fontSize: 12, color: '#9ca3af', minWidth: 60 }}>{time}</div>
        {isLive && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 10,
            fontWeight: 700,
            color: '#22c55e',
            background: '#064e3b',
            padding: '2px 6px',
            borderRadius: 4,
            whiteSpace: 'nowrap',
          }}>
            <span className="pulse-dot" style={{
              display: 'inline-block',
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#22c55e',
            }} />
            LIVE
          </div>
        )}
        <div style={{ fontSize: 11, color: verdictColor(verdict), fontWeight: 600, background: '#111827', padding: '2px 6px', borderRadius: 4 }}>
          {verdict}
        </div>
        <div style={{ fontSize: 12, color: '#d1d5db', flex: 1 }}>{missionId}</div>
        <div style={{ fontSize: 12, color: '#34d399', fontWeight: 600 }}>${amount}</div>
      </div>

      {expanded && (
        <div style={{ fontSize: 12, color: '#9ca3af', paddingTop: 8, borderTop: '1px solid #374151' }}>
          <div><strong>Approval ID:</strong> <code style={{ color: '#93c5fd' }}>{approval.id || approval.approvalId || '—'}</code></div>
          <div><strong>Client:</strong> {approval.clientAccountId || '—'}</div>
          <div><strong>Confidence:</strong> {approval.confidence != null ? `${(approval.confidence * 100).toFixed(1)}%` : '—'}</div>
          <div><strong>Decision:</strong> {approval.decision || '—'}</div>
          {approval.createdAt && <div><strong>Created:</strong> {new Date(approval.createdAt).toLocaleString()}</div>}
          {approval.resolvedAt && <div><strong>Resolved:</strong> {new Date(approval.resolvedAt).toLocaleString()}</div>}
          {missionLookupId && (
            <div style={{ marginTop: 8 }}>
              <a
                href={`/mission/${encodeURIComponent(missionLookupId)}`}
                style={{ color: '#93c5fd', textDecoration: 'none', fontWeight: 600 }}
                onClick={(e) => e.stopPropagation()}
              >
                View full mission audit →
              </a>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
        .pulse-dot {
          animation: pulse 1.4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}

// ── Bar Chart Component (CSS-based) ───────────────────────────────────────────
function BarChart({ label, percentage, color }) {
  const barWidth = Math.max(0, Math.min(100, percentage));
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
        <span style={{ color: '#d1d5db' }}>{label}</span>
        <span style={{ color: '#9ca3af' }}>{percentage.toFixed(1)}%</span>
      </div>
      <div style={{ background: '#111827', borderRadius: 4, height: 20, overflow: 'hidden', border: '1px solid #374151' }}>
        <div style={{
          width: `${barWidth}%`,
          height: '100%',
          background: color,
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
}

// ── Uptime formatter — skips leading-zero units ───────────────────────────────
// Examples: 8 → "8s"  |  72 → "1m 12s"  |  3723 → "1h 2m 3s"  |  90061 → "1d 1h 1m 1s"
function fmtUptime(secs) {
  const s = secs % 60;
  const m = Math.floor(secs / 60) % 60;
  const h = Math.floor(secs / 3600) % 24;
  const d = Math.floor(secs / 86400);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

// ── Main Dashboard Component ──────────────────────────────────────────────────

// ── [V154-DASH] Platform Summary Strip ────────────────────────────────────────
function PlatformSummaryStrip() {
  const [summary, setSummary] = React.useState(null);
  React.useEffect(() => {
    fetch(`${EXPRESS_BASE}/api/v1/dashboard/summary`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && !d.error && setSummary(d))
      .catch(() => {});
  }, []);
  if (!summary) return null;
  const cards = [
    { label: 'Validators',    value: summary.validatorCount  ?? '—', color: '#60a5fa' },
    { label: 'Pending Tasks', value: summary.activeTaskCount ?? '—', color: '#fbbf24' },
    { label: 'Auto-Flow Rate',value: (summary.autoFlowRate  ?? '—') + (summary.autoFlowRate != null ? '%' : ''), color: '#34d399' },
    { label: '7-Day Payout',  value: summary.weeklyPayoutUsd != null ? '$' + parseFloat(summary.weeklyPayoutUsd).toFixed(2) : '—', color: '#a78bfa' },
  ];
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
      {cards.map((c, i) => (
        <div key={i} style={{ flex: 1, minWidth: 160, background: '#1f2937', borderRadius: 8, padding: '12px 16px', border: '1px solid #374151' }}>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{c.label}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: c.color }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [health, setHealth] = useState({ chain: null, calibrator: null, queue: null, healthCheck: null });
  const [systemStats, setSystemStats] = useState(null); // [V75] /api/v1/stats data
  const [approvals, setApprovals] = useState([]);
  const [stats, setStats] = useState({ total: 0, volumeUsd: 0, autoFlowRate: 0, hitlRate: 0, avgConfidence: 0 });
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [liveIds, setLiveIds] = useState(new Set());
  const [sseError, setSseError] = useState(null);
  const [topValidators, setTopValidators] = useState([]);
  // [V77] Live uptime counter — seeded from server's actual uptime on each stats fetch
  const [uptimeSecs, setUptimeSecs] = useState(0);
  // [V78] Prometheus metrics panel state
  const [prometheusMetrics, setPrometheusMetrics] = useState(null);  // [{name, value}] | null=loading | false=error
  const [metricsLastUpdated, setMetricsLastUpdated] = useState(null); // [V85] HH:MM:SS timestamp
  const refreshIntervalRef = useRef(null);
  const esRef = useRef(null);

  // [V77] Tick every second to keep displayed uptime live between data refreshes
  useEffect(() => {
    const t = setInterval(() => setUptimeSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // [V78] Poll /api/v1/metrics every 10 seconds — parse Prometheus plain-text
  useEffect(() => {
    function parseMetrics(text) {
      return text.split('\n')
        .filter(line => /^ecos_\w+ [\d.]+$/.test(line.trim()))
        .map(line => {
          const [name, value] = line.trim().split(' ');
          return { name, value };
        });
    }
    async function fetchMetrics() {
      try {
        const r = await fetch(`${EXPRESS_BASE}/api/v1/metrics`);
        if (!r.ok) { setPrometheusMetrics(false); return; }
        const text = await r.text();
        setPrometheusMetrics(parseMetrics(text));
        setMetricsLastUpdated(new Date().toLocaleTimeString()); // [V85] update timestamp
      } catch (_) {
        setPrometheusMetrics(false);
      }
    }
    fetchMetrics();
    const t = setInterval(fetchMetrics, 10000);
    return () => clearInterval(t);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      // [V75] Fetch /api/v1/stats alongside existing endpoints
      const [verifyRes, calibRes, approvalsRes, healthRes, statsRes] = await Promise.all([
        fetch(`${EXPRESS_BASE}/api/v1/verify`),
        fetch(`${EXPRESS_BASE}/api/v1/calibrator`),
        fetch(`${EXPRESS_BASE}/api/v1/approvals?status=all`),
        fetch(`${EXPRESS_BASE}/api/v1/health`),
        fetch(`${EXPRESS_BASE}/api/v1/stats`),
      ]);

      const verifyData = await verifyRes.json();
      const calibData = await calibRes.json();
      const approvalsData = await approvalsRes.json();
      const healthData = await healthRes.json();
      const statsData = statsRes.ok ? await statsRes.json() : null;

      // [V75] Persist stats for health card population
      if (statsData) {
        setSystemStats(statsData);
        // [V77] Seed live uptime counter with the server's actual uptime
        setUptimeSecs(Math.round(statsData.uptime || 0));
      }

      setHealth({
        chain: {
          // prefer /api/v1/stats chain data when available
          ok: statsData ? statsData.chain.ok : (verifyData.ok || verifyData.length > 0),
          chainLength: statsData ? statsData.chain.length : (verifyData.chainLength || verifyData.length || 0),
        },
        calibrator: {
          // prefer /api/v1/stats calibrator data when available
          ready: statsData ? statsData.calibrator.ready : (calibData.fitted || false),
          sampleCount: statsData ? statsData.calibrator.sampleCount : (calibData.sampleCount || 0),
          samplesNeeded: calibData.samplesNeeded || 50,
        },
        queue: {
          // prefer /api/v1/stats pending approvals count when available
          count: statsData ? statsData.approvals.pending : (Array.isArray(approvalsData.approvals) ? approvalsData.approvals.length : 0),
        },
        healthCheck: healthData,
      });

      // Process approvals for feed and stats
      const allApprovals = Array.isArray(approvalsData.approvals) ? approvalsData.approvals : [];
      const sorted = allApprovals.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50);
      setApprovals(sorted);

      // Calculate stats
      const total = allApprovals.length;
      const volumeUsd = allApprovals.reduce((sum, a) => sum + (parseFloat(a.priceUsd) || 0), 0);
      const autoFlowCount = allApprovals.filter(a => a.verdict === 'AUTO_FLOW' || a.status === 'AUTO_FLOW').length;
      const hitlCount = allApprovals.filter(a => a.verdict === 'HITL_QUEUE' || a.status === 'HITL_QUEUE').length;
      const withConfidence = allApprovals.filter(a => a.confidence != null);
      const avgConf = withConfidence.length > 0
        ? withConfidence.reduce((sum, a) => sum + a.confidence, 0) / withConfidence.length
        : 0;

      setStats({
        total,
        volumeUsd,
        autoFlowRate: total > 0 ? (autoFlowCount / total) * 100 : 0,
        hitlRate: total > 0 ? (hitlCount / total) * 100 : 0,
        avgConfidence: avgConf * 100,
      });

      // Top Validators: group by validatorAccountId, sum priceUsd*0.40 for approved/modified
      const earningsMap = new Map();
      allApprovals
        .filter(a => a.decision === 'approve' || a.decision === 'modify')
        .forEach(a => {
          const vid = a.validatorAccountId || 'unknown';
          const earned = (parseFloat(a.priceUsd || '0') * 0.4);
          earningsMap.set(vid, (earningsMap.get(vid) || 0) + earned);
        });
      const ranked = Array.from(earningsMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id, earned]) => ({ id, earned }));
      setTopValidators(ranked);

      setLoading(false);
    } catch (err) {
      console.error('Dashboard fetch error:', err);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    refreshIntervalRef.current = setInterval(fetchData, 10000);

    // SSE live feed
    const validatorId = 'validator::dashboard_observer';
    const es = new EventSource(`${EXPRESS_BASE}/api/v1/stream?validatorId=${encodeURIComponent(validatorId)}`);
    esRef.current = es;

    es.addEventListener('approval.created', (event) => {
      try {
        const payload = JSON.parse(event.data);
        const approval = payload.approval || payload;
        const id = approval.id || approval.approvalId;
        if (!id) return;

        setApprovals((prev) => {
          const exists = prev.some((a) => (a.id || a.approvalId) === id);
          if (exists) return prev;
          const combined = [approval, ...prev];
          return combined.slice(0, 50);
        });
        setLiveIds((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
        setSseError(null);
      } catch (e) {
        console.error('SSE approval.created parse error:', e);
      }
    });

    es.addEventListener('approval.resolved', (event) => {
      try {
        const payload = JSON.parse(event.data);
        const approval = payload.approval || payload;
        const id = approval.id || approval.approvalId;
        if (!id) return;

        setApprovals((prev) =>
          prev.map((a) => {
            const aid = a.id || a.approvalId;
            if (aid === id) {
              return { ...a, verdict: approval.verdict || a.verdict, status: approval.status || a.status, resolvedAt: approval.resolvedAt || a.resolvedAt };
            }
            return a;
          })
        );
        setSseError(null);
      } catch (e) {
        console.error('SSE approval.resolved parse error:', e);
      }
    });

    es.onerror = () => {
      setSseError('⚡ Live updates paused — reconnecting…');
    };

    return () => {
      clearInterval(refreshIntervalRef.current);
      es.close();
    };
  }, [fetchData]);

  if (loading && approvals.length === 0) {
    return (
      <div style={{ padding: 20, color: '#9ca3af', textAlign: 'center' }}>
        Loading dashboard…
      </div>
    );
  }

  return (
    <div style={{ padding: 20, background: '#111827', minHeight: '100vh', color: '#d1d5db' }}>
      <h1 style={{ marginBottom: 20, fontSize: 24, fontWeight: 600 }}>System Dashboard</h1>

      {/* SECTION A: System Health — [V75] populated from /api/v1/stats */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <HealthCard
          icon="⛓️"
          label="Chain Integrity"
          value={health.chain?.ok ? 'Intact' : 'Broken'}
          status={health.chain?.ok ? 'good' : 'warning'}
          detail={`Length: ${health.chain?.chainLength ?? (systemStats?.chain?.length ?? 0)}`}
        />
        <HealthCard
          icon="🔧"
          label="Calibrator"
          value={health.calibrator?.ready ? 'Ready' : 'Not Ready'}
          status={health.calibrator?.ready ? 'good' : 'warning'}
          detail={`${health.calibrator?.sampleCount ?? (systemStats?.calibrator?.sampleCount ?? 0)}/${health.calibrator?.samplesNeeded || 50} samples`}
        />
        <HealthCard
          icon="📋"
          label="Pending Queue"
          value={systemStats ? systemStats.approvals.pending : (health.queue?.count ?? 0)}
          status={(systemStats ? systemStats.approvals.pending : (health.queue?.count ?? 0)) === 0 ? 'good' : 'warning'}
          detail={systemStats ? `${systemStats.approvals.all ?? systemStats.approvals.total ?? 0} total approvals` : 'Approvals waiting'}
        />
        <HealthCard
          icon="🟢"
          label="Server"
          value={systemStats ? `V${systemStats.version || '77'}` : 'Online'}
          status={systemStats ? (systemStats.db === 'connected' ? 'good' : 'warning') : 'good'}
          detail={`Online · ${fmtUptime(uptimeSecs)} · DB ${systemStats?.db ?? 'connecting'}`}
        />
        <HealthCard
          icon="🔗"
          label="Chain Length"
          value={systemStats?.chain?.length ?? (health.healthCheck?.chain?.length ?? '...')}
          color="#a78bfa"
          status="good"
          detail={
            systemStats?.chain?.headHash
              ? `Head: ${systemStats.chain.headHash}`
              : health.healthCheck?.chain?.headHash
              ? `Head: ${health.healthCheck.chain.headHash}`
              : 'Connected'
          }
        />
      </div>

      {/* SECTION B & C: Activity Feed + Stats */}
      <div style={{ display: 'flex', gap: 20 }}>
        {/* Activity Feed (60%) */}
        <div style={{ flex: '0 0 60%', maxHeight: '600px', overflowY: 'auto', paddingRight: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: '#e5e7eb' }}>Recent Activity</h2>
            {sseError && (
              <span style={{ fontSize: 11, color: '#fcd34d' }}>{sseError}</span>
            )}
          </div>
          {approvals.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: 14 }}>No approvals yet.</div>
          ) : (
            approvals.map((a) => (
              <ActivityItem
                key={a.id || a.approvalId}
                approval={a}
                expanded={expandedId === (a.id || a.approvalId)}
                onToggle={() => setExpandedId(expandedId === (a.id || a.approvalId) ? null : (a.id || a.approvalId))}
                isLive={liveIds.has(a.id || a.approvalId)}
              />
            ))
          )}
        </div>

        {/* Stats Sidebar (40%) */}
        <div style={{ flex: '0 0 40%', background: '#1f2937', border: '1px solid #374151', borderRadius: 8, padding: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: '#e5e7eb' }}>Statistics</h2>

          <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #374151' }}>
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Total Missions</div>
            <div style={{ fontSize: 24, fontWeight: 600, color: '#93c5fd' }}>{stats.total}</div>
          </div>

          <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #374151' }}>
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Total Volume</div>
            <div style={{ fontSize: 24, fontWeight: 600, color: '#34d399' }}>${stats.volumeUsd.toFixed(2)}</div>
          </div>

          <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #374151' }}>
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 4 }}>Avg Confidence</div>
            <div style={{ fontSize: 24, fontWeight: 600, color: '#fcd34d' }}>{stats.avgConfidence.toFixed(1)}%</div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8, fontWeight: 600 }}>Flow Distribution</div>
            <BarChart label="AUTO_FLOW" percentage={stats.autoFlowRate} color="#34d399" />
            <BarChart label="HITL" percentage={stats.hitlRate} color="#fcd34d" />
          </div>

          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #374151' }}>
            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8, fontWeight: 600 }}>Top Validators</div>
            {topValidators.length === 0 ? (
              <div style={{ fontSize: 12, color: '#6b7280' }}>(none yet)</div>
            ) : (
              topValidators.map((v) => (
                <div key={v.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
                  <code style={{ color: '#93c5fd', fontSize: 11 }}>{v.id}</code>
                  <span style={{ color: '#34d399', fontWeight: 600 }}>${v.earned.toFixed(2)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* SECTION D: Prometheus Metrics panel — [V78] */}
      <div style={{ marginTop: 24, background: '#1f2937', border: '1px solid #374151', borderRadius: 8, padding: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#e5e7eb' }}>📡 Prometheus Metrics</h2>
        {prometheusMetrics === null ? (
          <div style={{ fontSize: 13, color: '#9ca3af' }}>Fetching metrics…</div>
        ) : prometheusMetrics === false ? (
          <div style={{ fontSize: 13, color: '#f87171' }}>Metrics unavailable</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', color: '#9ca3af', fontWeight: 500, paddingBottom: 6, borderBottom: '1px solid #374151' }}>Metric</th>
                <th style={{ textAlign: 'right', color: '#9ca3af', fontWeight: 500, paddingBottom: 6, borderBottom: '1px solid #374151' }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {prometheusMetrics.map(({ name, value }) => (
                <tr key={name}>
                  <td style={{ padding: '5px 0', color: '#93c5fd', fontFamily: 'monospace', fontSize: 12 }}>{name}</td>
                  <td style={{ padding: '5px 0', textAlign: 'right', color: '#34d399', fontWeight: 600 }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {/* [V85] Last updated timestamp — rendered below metrics table, updated every poll cycle */}
        {metricsLastUpdated && (
          <div style={{ marginTop: 8, fontSize: 11, color: '#6b7280', textAlign: 'right' }}>
            Last updated: {metricsLastUpdated}
          </div>
        )}
      </div>

      {/* Auto-refresh indicator */}
      <div style={{ marginTop: 20, fontSize: 12, color: '#6b7280', textAlign: 'center' }}>
        Auto-refreshing every 10 seconds
      </div>
    </div>
  );
}
