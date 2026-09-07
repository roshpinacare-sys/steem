/**
 * Admin Notifications Metrics Page — ECOS V137 (Track G + Track F)
 * ─────────────────────────────────────────────────────────────────────────────
 * [V137-NG] /admin/notifications-metrics — operator surface for delivery
 * observability.
 *
 * Features:
 *   - Total notifications + unread rate.
 *   - WS clients / users currently connected.
 *   - Delivery success/failure counts for ws and webhook channels.
 *   - Breakdown by type (bar chart via CSS).
 *   - Recent-day histogram.
 *   - Auto-refreshes every 30 s.
 *   - No external libraries — inline styles only.
 */

'use client';

import { useState, useEffect, useRef } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
const REFRESH_INTERVAL_MS = 30_000;

export default function NotificationsMetricsPage() {
  const [metrics, setMetrics]   = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error,   setError]     = useState(null);
  const [lastAt,  setLastAt]    = useState(null);
  const timerRef = useRef(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/rank/notifications-metrics`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMetrics(data);
      setLastAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(timerRef.current);
  }, []);

  if (loading && !metrics) return <div style={loadingStyle}>Loading metrics…</div>;
  if (error && !metrics)   return <div style={errorStyle}>Error: {error}</div>;

  const m = metrics || {};
  const byType = m.byType || {};
  const byDay  = m.byDay  || {};
  const delivery = m.delivery || { ws: {}, webhook: {} };

  const maxTypeCount = Math.max(1, ...Object.values(byType));
  const dayEntries   = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).slice(-14);
  const maxDayCount  = Math.max(1, ...dayEntries.map(([, v]) => v));

  return (
    <div style={pageStyle}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>🔔 Notification Delivery Metrics</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {lastAt && <span style={lastAtStyle}>Updated: {lastAt}</span>}
          <button onClick={load} disabled={loading} style={btnStyle}>
            {loading ? '↺ Loading…' : '↺ Refresh'}
          </button>
        </div>
      </div>

      {error && <div style={alertStyle}>Warning: {error}</div>}

      {/* KPI row */}
      <div style={kpiRowStyle}>
        <KpiCard label="Total Notifications" value={m.totalNotifications ?? '—'} />
        <KpiCard label="Unread"              value={m.totalUnread ?? '—'} accent="#f59e0b" />
        <KpiCard label="Unread Rate"         value={m.unreadRate != null ? `${(m.unreadRate * 100).toFixed(1)}%` : '—'} />
        <KpiCard label="Users w/ Notifs"     value={m.users ?? '—'} />
        <KpiCard label="WS Clients"          value={m.wsClients ?? '—'} accent="#22c55e" />
        <KpiCard label="WS Users"            value={m.wsUsers ?? '—'} />
      </div>

      {/* Delivery channels */}
      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Delivery Channels</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <DeliveryPanel label="WebSocket (ws)" channel={delivery.ws} colour="#3b82f6" />
          <DeliveryPanel label="Webhook"        channel={delivery.webhook} colour="#a78bfa" />
        </div>
      </div>

      {/* By type */}
      {Object.keys(byType).length > 0 && (
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>By Notification Type</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Object.entries(byType).sort(([, a], [, b]) => b - a).map(([type, count]) => (
              <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 160, fontSize: 12, color: '#9ca3af', textTransform: 'capitalize' }}>
                  {type.replace(/_/g, ' ')}
                </span>
                <div style={{ flex: 1, background: '#1f2937', borderRadius: 4, height: 16, overflow: 'hidden' }}>
                  <div style={{
                    width:      `${Math.round((count / maxTypeCount) * 100)}%`,
                    background: '#3b82f6',
                    height:     '100%',
                    borderRadius: 4,
                    transition: 'width 0.4s ease',
                  }} />
                </div>
                <span style={{ fontSize: 12, color: '#e5e7eb', width: 40, textAlign: 'right' }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily histogram */}
      {dayEntries.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>Daily Volume (last 14 days)</h2>
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 80 }}>
            {dayEntries.map(([day, count]) => (
              <div key={day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <div
                  title={`${day}: ${count}`}
                  style={{
                    width:        '100%',
                    height:       `${Math.round((count / maxDayCount) * 60)}px`,
                    background:   '#3b82f6',
                    borderRadius: '2px 2px 0 0',
                    minHeight:    4,
                    transition:   'height 0.4s ease',
                  }}
                />
                <span style={{ fontSize: 9, color: '#6b7280', transform: 'rotate(-40deg)', transformOrigin: 'top right', whiteSpace: 'nowrap' }}>
                  {day.slice(5)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Min streak */}
      {m.minStreakForReminder != null && (
        <p style={{ fontSize: 12, color: '#6b7280', marginTop: 16 }}>
          Streak reminder threshold: {m.minStreakForReminder} days
        </p>
      )}
    </div>
  );
}

function KpiCard({ label, value, accent = '#3b82f6' }) {
  return (
    <div style={kpiCardStyle}>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent }}>{value}</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{label}</div>
    </div>
  );
}

function DeliveryPanel({ label, channel = {}, colour }) {
  const { success = 0, failed = 0, total = 0, successRate } = channel;
  return (
    <div style={{ background: '#0f172a', border: '1px solid #1f2937', borderRadius: 8, padding: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 14, color: colour, marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', gap: 16 }}>
        <Stat label="Success" value={success} colour="#22c55e" />
        <Stat label="Failed"  value={failed}  colour="#f87171" />
        <Stat label="Total"   value={total} />
        <Stat label="Rate"    value={successRate != null ? `${(successRate * 100).toFixed(1)}%` : 'n/a'} />
      </div>
    </div>
  );
}

function Stat({ label, value, colour = '#9ca3af' }) {
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, color: colour }}>{value}</div>
      <div style={{ fontSize: 10, color: '#6b7280' }}>{label}</div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const pageStyle       = { maxWidth: 960, margin: '0 auto', padding: '24px 16px', color: '#e5e7eb', fontFamily: '"Inter", system-ui, sans-serif' };
const headerStyle     = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 8 };
const titleStyle      = { fontSize: 22, fontWeight: 700 };
const lastAtStyle     = { fontSize: 12, color: '#6b7280' };
const btnStyle        = { background: '#1f2937', color: '#e5e7eb', border: '1px solid #374151', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 };
const alertStyle      = { background: '#422006', border: '1px solid #92400e', color: '#fcd34d', borderRadius: 8, padding: '8px 14px', marginBottom: 12, fontSize: 13 };
const errorStyle      = { color: '#f87171', padding: 24 };
const loadingStyle    = { color: '#6b7280', padding: 24 };
const kpiRowStyle     = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12, marginBottom: 24 };
const kpiCardStyle    = { background: '#111827', border: '1px solid #1f2937', borderRadius: 8, padding: '14px 16px' };
const sectionStyle    = { background: '#111827', border: '1px solid #1f2937', borderRadius: 8, padding: 16, marginBottom: 16 };
const sectionTitleStyle = { fontSize: 14, fontWeight: 600, color: '#9ca3af', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' };
