/**
 * Notifications Page — ECOS V149
 * ─────────────────────────────────────────────────────────────────────────────
 * [V149-NP] Enhanced notifications with full Preferences panel.
 *
 * V137 features preserved:
 *   - Per-user notification inbox with unread badge
 *   - Mark-all-read + per-notification mark-read
 *   - Type filter (All / Promotions / Demotions / Streaks / Broadcasts)
 *   - Live WebSocket updates via /ws/notifications
 *
 * V149 additions [V149-NP]:
 *   - ⚙️ Preferences Panel (collapsible):
 *       • Mute toggles by notification type
 *       • Quiet hours (start/end UTC hour, with midnight-wrap display)
 *       • Preferred channel: ws / webhook / none
 *       • Preferred locale: en / he / ar
 *   - GET /api/v1/rank/notifications/:userId/prefs — load on panel open
 *   - PUT /api/v1/rank/notifications/:userId/prefs — save on Apply
 *   - Optimistic UI: save indicator (Saving… / Saved ✓ / Error)
 *
 * No external dependencies — inline styles only. RTL-aware.
 */

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

const TYPE_LABELS = {
  all:               'All',
  tier_promotion:    '🎉 Promotions',
  tier_demotion:     '↓ Demotions',
  streak_reminder:   '🔥 Streaks',
  channel_broadcast: '📡 Broadcasts',
};

const TYPE_COLOURS = {
  tier_promotion:    '#22c55e',
  tier_demotion:     '#f87171',
  streak_reminder:   '#fb923c',
  channel_broadcast: '#60a5fa',
};

const MUTABLE_TYPES = ['tier_promotion', 'tier_demotion', 'streak_reminder', 'channel_broadcast'];

const CHANNELS  = ['ws', 'webhook', 'none'];
const LOCALES   = ['en', 'he', 'ar'];

const DEFAULT_PREFS = { locale: 'en', muted: [], quietHours: null, channel: 'ws' };

// ── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function notifColor(type) { return TYPE_COLOURS[type] || '#9ca3af'; }

// ── Main Component ────────────────────────────────────────────────────────────
export default function NotificationsPage() {
  const [userId,        setUserId]        = useState('demo-user');
  const [notifications, setNotifications] = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState(null);
  const [filter,        setFilter]        = useState('all');
  const [wsStatus,      setWsStatus]      = useState('disconnected');
  const wsRef = useRef(null);

  // ── Prefs state [V149-NP] ─────────────────────────────────────────────────
  const [prefsOpen,    setPrefsOpen]    = useState(false);
  const [prefs,        setPrefs]        = useState(DEFAULT_PREFS);
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [saveStatus,   setSaveStatus]   = useState('idle'); // idle | saving | saved | error

  // local editable copies
  const [mutedLocal,  setMutedLocal]  = useState([]);
  const [qhEnabled,   setQhEnabled]   = useState(false);
  const [qhStart,     setQhStart]     = useState(22);
  const [qhEnd,       setQhEnd]       = useState(7);
  const [channelLocal, setChannelLocal] = useState('ws');
  const [localeLocal,  setLocaleLocal]  = useState('en');

  // ── Load notifications ────────────────────────────────────────────────────
  const loadNotifications = useCallback(async () => {
    if (!userId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (filter !== 'all') params.set('type', filter);
      const res = await fetch(`${API_BASE}/api/v1/rank/notifications/${encodeURIComponent(userId)}?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNotifications(data.notifications || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [userId, filter]);

  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  // ── WebSocket ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId.trim()) return;
    const wsBase = (API_BASE || 'http://localhost:3000').replace(/^http/, 'ws');
    const ws = new WebSocket(`${wsBase}/ws/notifications?userId=${encodeURIComponent(userId)}`);
    wsRef.current = ws;
    ws.onopen    = () => setWsStatus('connected');
    ws.onclose   = () => setWsStatus('disconnected');
    ws.onerror   = () => setWsStatus('error');
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'notification') {
          setNotifications(prev => [msg.notification, ...prev].slice(0, 100));
        }
      } catch {}
    };
    return () => ws.close();
  }, [userId]);

  // ── Load prefs [V149-NP] ──────────────────────────────────────────────────
  const loadPrefs = useCallback(async () => {
    if (!userId.trim()) return;
    setPrefsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/rank/notifications/${encodeURIComponent(userId)}/prefs`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const p = { ...DEFAULT_PREFS, ...(data.prefs || data) };
      setPrefs(p);
      setMutedLocal(p.muted || []);
      setChannelLocal(p.channel || 'ws');
      setLocaleLocal(p.locale || 'en');
      if (p.quietHours) {
        setQhEnabled(true);
        setQhStart(p.quietHours.start ?? 22);
        setQhEnd(p.quietHours.end ?? 7);
      } else {
        setQhEnabled(false);
      }
    } catch {
      // non-fatal — show defaults
    } finally {
      setPrefsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (prefsOpen) loadPrefs();
  }, [prefsOpen, loadPrefs]);

  // ── Save prefs [V149-NP] ──────────────────────────────────────────────────
  const savePrefs = async () => {
    setSaveStatus('saving');
    const payload = {
      muted:      mutedLocal,
      channel:    channelLocal,
      locale:     localeLocal,
      quietHours: qhEnabled ? { start: qhStart, end: qhEnd } : null,
    };
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/rank/notifications/${encodeURIComponent(userId)}/prefs`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const toggleMuted = (type) => {
    setMutedLocal(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  // ── Actions ───────────────────────────────────────────────────────────────
  const markAllRead = async () => {
    try {
      await fetch(
        `${API_BASE}/api/v1/rank/notifications/${encodeURIComponent(userId)}/read-all`,
        { method: 'POST' }
      );
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {}
  };

  const markOneRead = async (id) => {
    try {
      await fetch(
        `${API_BASE}/api/v1/rank/notifications/${encodeURIComponent(userId)}/read/${id}`,
        { method: 'POST' }
      );
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    } catch {}
  };

  const unreadCount = notifications.filter(n => !n.read).length;
  const visible     = filter === 'all' ? notifications : notifications.filter(n => n.type === filter);

  return (
    <div style={pageStyle}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={titleStyle}>
            Notifications
            {unreadCount > 0 && (
              <span style={badgeStyle}>{unreadCount}</span>
            )}
          </h1>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={() => setPrefsOpen(o => !o)} style={prefsBtnStyle}>
              ⚙️ Preferences
            </button>
            {unreadCount > 0 && (
              <button onClick={markAllRead} style={markReadBtnStyle}>
                ✓ Mark all read
              </button>
            )}
          </div>
        </div>

        {/* User ID input */}
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ color: '#6b7280', fontSize: 13 }}>User ID:</label>
          <input
            value={userId}
            onChange={e => setUserId(e.target.value)}
            onBlur={loadNotifications}
            style={inputStyle}
            placeholder="Enter user ID…"
          />
          <span style={{ fontSize: 12, color: wsStatus === 'connected' ? '#22c55e' : '#6b7280' }}>
            ● WS: {wsStatus}
          </span>
        </div>
      </div>

      {/* ── Prefs Panel [V149-NP] ────────────────────────────────── */}
      {prefsOpen && (
        <div style={prefsPanelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>⚙️ Notification Preferences</h2>
            <button onClick={() => setPrefsOpen(false)} style={closeBtnStyle}>✕</button>
          </div>

          {prefsLoading ? (
            <p style={{ color: '#6b7280' }}>Loading preferences…</p>
          ) : (
            <>
              {/* Mute by type */}
              <div style={prefsSectionStyle}>
                <div style={prefsSectionTitle}>Mute notification types</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
                  {MUTABLE_TYPES.map(type => (
                    <label key={type} style={muteToggleStyle(mutedLocal.includes(type))}>
                      <input
                        type="checkbox"
                        checked={mutedLocal.includes(type)}
                        onChange={() => toggleMuted(type)}
                        style={{ marginRight: 6 }}
                      />
                      {TYPE_LABELS[type]}
                    </label>
                  ))}
                </div>
                {mutedLocal.length > 0 && (
                  <p style={{ color: '#fb923c', fontSize: 12, marginTop: 6 }}>
                    🔕 {mutedLocal.length} type{mutedLocal.length > 1 ? 's' : ''} muted
                  </p>
                )}
              </div>

              {/* Quiet hours */}
              <div style={prefsSectionStyle}>
                <div style={prefsSectionTitle}>Quiet hours (UTC)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <label style={toggleLabelStyle}>
                    <input type="checkbox" checked={qhEnabled} onChange={e => setQhEnabled(e.target.checked)} style={{ marginRight: 6 }} />
                    Enable quiet hours
                  </label>
                  {qhEnabled && (
                    <>
                      <span style={{ color: '#6b7280', fontSize: 13 }}>From</span>
                      <input type="number" min={0} max={23} value={qhStart} onChange={e => setQhStart(Number(e.target.value))} style={numInputStyle} />
                      <span style={{ color: '#6b7280', fontSize: 13 }}>to</span>
                      <input type="number" min={0} max={23} value={qhEnd} onChange={e => setQhEnd(Number(e.target.value))} style={numInputStyle} />
                      <span style={{ color: '#6b7280', fontSize: 12 }}>
                        {qhStart > qhEnd ? '(wraps midnight)' : ''}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Channel */}
              <div style={prefsSectionStyle}>
                <div style={prefsSectionTitle}>Delivery channel</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {CHANNELS.map(ch => (
                    <button key={ch} onClick={() => setChannelLocal(ch)}
                      style={{ ...channelBtnStyle, ...(channelLocal === ch ? channelBtnActive : {}) }}>
                      {ch === 'ws' ? '⚡ WebSocket' : ch === 'webhook' ? '🔗 Webhook' : '🔇 None'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Locale */}
              <div style={prefsSectionStyle}>
                <div style={prefsSectionTitle}>Preferred language</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {LOCALES.map(l => (
                    <button key={l} onClick={() => setLocaleLocal(l)}
                      style={{ ...channelBtnStyle, ...(localeLocal === l ? channelBtnActive : {}) }}>
                      {l === 'en' ? '🇺🇸 EN' : l === 'he' ? '🇮🇱 HE' : '🌍 AR'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Save button */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
                <button onClick={savePrefs} disabled={saveStatus === 'saving'} style={saveBtnStyle}>
                  {saveStatus === 'saving' ? 'Saving…' : 'Apply'}
                </button>
                {saveStatus === 'saved'  && <span style={{ color: '#22c55e', fontSize: 13 }}>✓ Saved</span>}
                {saveStatus === 'error'  && <span style={{ color: '#f87171', fontSize: 13 }}>⚠️ Failed to save</span>}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Filter tabs ──────────────────────────────────────────── */}
      <div style={filterBarStyle}>
        {Object.entries(TYPE_LABELS).map(([key, label]) => (
          <button key={key} onClick={() => setFilter(key)} style={filterBtnStyle(filter === key)}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Error ────────────────────────────────────────────────── */}
      {error && <div style={errorStyle}>⚠️ {error}</div>}

      {/* ── Loading ──────────────────────────────────────────────── */}
      {loading && <div style={loadingStyle}>Loading notifications…</div>}

      {/* ── Notification list ─────────────────────────────────────  */}
      {!loading && (
        <div>
          {visible.length === 0 ? (
            <div style={emptyStyle}>No notifications yet. Actions like tier promotions, streaks, and broadcasts will appear here.</div>
          ) : (
            visible.map(n => (
              <div key={n.id} style={notifCardStyle(n.read)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div>
                    <span style={{ ...typePillStyle, background: notifColor(n.type) + '22', color: notifColor(n.type) }}>
                      {TYPE_LABELS[n.type] || n.type}
                    </span>
                    <p style={{ margin: '8px 0 4px', color: n.read ? '#9ca3af' : '#f1f5f9', fontWeight: n.read ? 400 : 600, fontSize: 14 }}>
                      {n.message || n.body || '(no message)'}
                    </p>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>{timeAgo(n.createdAt)}</span>
                  </div>
                  {!n.read && (
                    <button onClick={() => markOneRead(n.id)} style={markOneBtnStyle}>
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const pageStyle        = { minHeight: '100vh', background: '#0f172a', color: '#e5e7eb', padding: '32px 24px', maxWidth: 860, margin: '0 auto' };
const headerStyle      = { marginBottom: 24 };
const titleStyle       = { fontSize: 24, fontWeight: 800, color: '#f1f5f9', margin: 0, display: 'inline-flex', alignItems: 'center', gap: 10 };
const badgeStyle       = { background: '#dc2626', color: '#fff', borderRadius: 999, padding: '2px 9px', fontSize: 13, fontWeight: 700 };
const prefsBtnStyle    = { background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 7, padding: '6px 14px', cursor: 'pointer', fontSize: 13 };
const markReadBtnStyle = { background: '#14532d', color: '#4ade80', border: '1px solid #166534', borderRadius: 7, padding: '6px 14px', cursor: 'pointer', fontSize: 13 };
const inputStyle       = { background: '#1e293b', color: '#f1f5f9', border: '1px solid #334155', borderRadius: 6, padding: '6px 12px', fontSize: 13, outline: 'none', width: 200 };
const filterBarStyle   = { display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' };
const filterBtnStyle = (active) => ({
  background: active ? '#1d4ed8' : '#1e293b',
  color:      active ? '#fff' : '#94a3b8',
  border:     active ? '1px solid #3b82f6' : '1px solid #334155',
  borderRadius: 7, padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 400,
});
const errorStyle   = { background: '#7f1d1d', color: '#fca5a5', borderRadius: 8, padding: '12px 16px', marginBottom: 16 };
const loadingStyle = { color: '#6b7280', padding: '32px 0', textAlign: 'center' };
const emptyStyle   = { color: '#6b7280', padding: '40px 0', textAlign: 'center', fontSize: 14 };
const notifCardStyle = (read) => ({
  background:   read ? '#0f172a' : '#111827',
  border:       `1px solid ${read ? '#1e293b' : '#334155'}`,
  borderLeft:   read ? '3px solid #1e293b' : '3px solid #3b82f6',
  borderRadius: 8, padding: '14px 16px', marginBottom: 10,
});
const typePillStyle  = { display: 'inline-block', borderRadius: 5, padding: '2px 9px', fontSize: 12, fontWeight: 600 };
const markOneBtnStyle = { background: 'transparent', color: '#6b7280', border: '1px solid #334155', borderRadius: 5, padding: '4px 10px', cursor: 'pointer', fontSize: 12, whiteSpace: 'nowrap' };

// Prefs panel
const prefsPanelStyle = {
  background: '#1e293b', border: '1px solid #334155', borderRadius: 12,
  padding: 24, marginBottom: 24,
};
const prefsSectionStyle = { marginBottom: 20 };
const prefsSectionTitle = { color: '#94a3b8', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' };
const muteToggleStyle = (active) => ({
  display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
  background: active ? '#7f1d1d' : '#0f172a', color: active ? '#fca5a5' : '#9ca3af',
  border: `1px solid ${active ? '#dc2626' : '#334155'}`, borderRadius: 7,
  padding: '5px 12px', fontSize: 13, fontWeight: active ? 600 : 400,
});
const toggleLabelStyle  = { display: 'inline-flex', alignItems: 'center', color: '#d1d5db', fontSize: 13, cursor: 'pointer' };
const numInputStyle     = { background: '#0f172a', color: '#f1f5f9', border: '1px solid #334155', borderRadius: 5, padding: '4px 8px', width: 52, fontSize: 14, textAlign: 'center', outline: 'none' };
const channelBtnStyle   = { background: '#0f172a', color: '#9ca3af', border: '1px solid #334155', borderRadius: 7, padding: '6px 14px', cursor: 'pointer', fontSize: 13 };
const channelBtnActive  = { background: '#1d4ed8', color: '#fff', border: '1px solid #3b82f6', fontWeight: 600 };
const saveBtnStyle      = { background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 7, padding: '8px 24px', cursor: 'pointer', fontSize: 14, fontWeight: 600 };
const closeBtnStyle     = { background: 'transparent', color: '#6b7280', border: '1px solid #334155', borderRadius: 5, padding: '4px 10px', cursor: 'pointer', fontSize: 14 };
