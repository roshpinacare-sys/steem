'use client';
/**
 * Communication Channels — ECOS V135
 * ─────────────────────────────────────────────────────────────────────────────
 * [V135-RH-05] Rank-gated channel subscription UI.
 *
 * Shows:
 *   - All available channels with rank requirement
 *   - User's accessible channels based on rank tier
 *   - Subscribe / unsubscribe actions
 *   - System-wide subscription stats
 */

import { useState, useEffect, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

const TIER_COLORS = {
  OBSERVER:    { accent: '#6b7280', bg: '#111827', border: '#374151' },
  MEMBER:      { accent: '#22c55e', bg: '#0f2318', border: '#166534' },
  CONTRIBUTOR: { accent: '#3b82f6', bg: '#0f1b2d', border: '#1d4ed8' },
  VALIDATOR:   { accent: '#8b5cf6', bg: '#1a0f2e', border: '#7c3aed' },
  STEWARD:     { accent: '#f59e0b', bg: '#1f1506', border: '#b45309' },
  SOVEREIGN:   { accent: '#f97316', bg: '#1f0e06', border: '#c2410c' },
};

const CHANNEL_ICONS = {
  'general':       '📢',
  'contributors':  '🔧',
  'validators':    '✅',
  'stewards':      '🛡️',
  'governance':    '⚖️',
  'sovereigns':    '👑',
};

function getTierColor(tier) {
  return TIER_COLORS[tier] || TIER_COLORS.OBSERVER;
}

// ── ChannelCard ───────────────────────────────────────────────────────────────

function ChannelCard({ channel, userId, onSubscribeChange }) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const isSubscribed = channel.subscribed;
  const canAccess    = channel.accessible !== false;
  const tc           = getTierColor(channel.minTier || 'OBSERVER');
  const icon         = CHANNEL_ICONS[channel.id] || '📡';

  async function handleToggle() {
    if (!userId) { setError('Enter a User ID above first'); return; }
    setLoading(true); setError(null);
    const endpoint = isSubscribed
      ? `/api/v1/comm/channels/${channel.id}/unsubscribe`
      : `/api/v1/comm/channels/${channel.id}/subscribe`;
    try {
      const r = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const d = await r.json();
      if (!r.ok || d.error) { setError(d.error || d.message || 'Request failed'); }
      else { onSubscribeChange(); }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div style={{
      background: canAccess ? tc.bg : '#0a0a0a',
      border: `1px solid ${canAccess ? tc.border : '#1f2937'}`,
      borderRadius: 12,
      padding: '20px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      opacity: canAccess ? 1 : 0.5,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>{icon}</span>
          <div>
            <div style={{ color: '#f9fafb', fontWeight: 600, fontSize: 15 }}>
              {channel.name || channel.id}
            </div>
            {channel.description && (
              <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 2 }}>
                {channel.description}
              </div>
            )}
          </div>
        </div>
        <div style={{
          background: tc.accent + '22',
          border: `1px solid ${tc.accent}55`,
          borderRadius: 6,
          padding: '3px 10px',
          color: tc.accent,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.05em',
          whiteSpace: 'nowrap',
        }}>
          {channel.minTier || 'OBSERVER'}+
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ color: '#6b7280', fontSize: 12 }}>
          {(channel.subscriberCount ?? 0).toLocaleString()} subscribers
        </div>
        {canAccess ? (
          <button
            onClick={handleToggle}
            disabled={loading}
            style={{
              background: isSubscribed ? '#1f2937' : tc.accent,
              border: `1px solid ${isSubscribed ? '#374151' : tc.accent}`,
              borderRadius: 7,
              padding: '6px 18px',
              color: isSubscribed ? '#9ca3af' : '#fff',
              fontWeight: 600,
              fontSize: 13,
              cursor: loading ? 'wait' : 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {loading ? '…' : isSubscribed ? 'Unsubscribe' : 'Subscribe'}
          </button>
        ) : (
          <span style={{ color: '#4b5563', fontSize: 12 }}>🔒 Rank required</span>
        )}
      </div>

      {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}
      {isSubscribed && (
        <div style={{ color: tc.accent, fontSize: 11, fontWeight: 600 }}>✓ Subscribed</div>
      )}
    </div>
  );
}

// ── StatsPanel ────────────────────────────────────────────────────────────────

function StatsPanel({ stats }) {
  if (!stats) return null;
  const items = [
    { label: 'Total subscriptions', value: stats.totalSubscriptions ?? '—' },
    { label: 'Active channels',     value: stats.channelCount ?? '—' },
    { label: 'Subscribers (max channel)', value: stats.maxSubscribers ?? '—' },
  ];
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
      {items.map(it => (
        <div key={it.label} style={{
          flex: 1, minWidth: 140,
          background: '#111827', border: '1px solid #1f2937',
          borderRadius: 10, padding: '14px 18px',
        }}>
          <div style={{ color: '#6b7280', fontSize: 11, marginBottom: 6 }}>{it.label}</div>
          <div style={{ color: '#f9fafb', fontWeight: 700, fontSize: 22 }}>
            {typeof it.value === 'number' ? it.value.toLocaleString() : it.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CommPage() {
  const [userId,   setUserId]   = useState('');
  const [channels, setChannels] = useState([]);
  const [allChans, setAllChans] = useState([]);
  const [stats,    setStats]    = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  // Load all channel definitions (no auth)
  useEffect(() => {
    fetch(`${API_BASE}/api/v1/comm/channels/list`)
      .then(r => r.json())
      .then(d => setAllChans(d.channels || []))
      .catch(() => {});
    fetch(`${API_BASE}/api/v1/comm/stats`)
      .then(r => r.json())
      .then(d => setStats(d))
      .catch(() => {});
  }, []);

  const loadUserChannels = useCallback(async (uid) => {
    if (!uid) { setChannels([]); return; }
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${API_BASE}/api/v1/comm/channels?userId=${encodeURIComponent(uid)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');
      setChannels(d.channels || []);
    } catch (e) { setError(e.message); setChannels([]); }
    finally { setLoading(false); }
  }, []);

  // Merge allChans with user subscription info
  const merged = (userId && channels.length > 0)
    ? channels
    : allChans.map(c => ({ ...c, accessible: false }));

  return (
    <div style={{
      minHeight: '100vh',
      background: '#030712',
      color: '#f9fafb',
      fontFamily: "'Inter', system-ui, sans-serif",
      padding: '40px 24px',
    }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, color: '#f9fafb' }}>
            📡 Communication Channels
          </h1>
          <p style={{ color: '#6b7280', marginTop: 8, fontSize: 14 }}>
            Rank-gated channels for the ECOS community. Higher tiers unlock more channels.
          </p>
        </div>

        {/* Stats */}
        <StatsPanel stats={stats} />

        {/* User ID input */}
        <div style={{
          background: '#0f172a', border: '1px solid #1e3a5f',
          borderRadius: 12, padding: '20px 24px', marginBottom: 28,
        }}>
          <label style={{ color: '#93c5fd', fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>
            Your User ID (enter to see accessible channels &amp; subscriptions)
          </label>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              type="text"
              value={userId}
              onChange={e => setUserId(e.target.value)}
              placeholder="user_abc123"
              style={{
                flex: 1, background: '#111827', border: '1px solid #374151',
                borderRadius: 8, padding: '8px 14px', color: '#f9fafb',
                fontSize: 14, outline: 'none',
              }}
            />
            <button
              onClick={() => loadUserChannels(userId)}
              disabled={!userId || loading}
              style={{
                background: '#1d4ed8', border: 'none', borderRadius: 8,
                padding: '8px 20px', color: '#fff', fontWeight: 600,
                fontSize: 14, cursor: userId && !loading ? 'pointer' : 'not-allowed',
                opacity: userId ? 1 : 0.5,
              }}
            >
              {loading ? '…' : 'Load'}
            </button>
          </div>
          {error && <div style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>{error}</div>}
        </div>

        {/* Channel grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {merged.map(ch => (
            <ChannelCard
              key={ch.id}
              channel={ch}
              userId={userId}
              onSubscribeChange={() => loadUserChannels(userId)}
            />
          ))}
          {merged.length === 0 && (
            <div style={{ color: '#6b7280', gridColumn: '1/-1', textAlign: 'center', padding: 40 }}>
              Loading channels…
            </div>
          )}
        </div>

        {/* Footer note */}
        <div style={{ marginTop: 36, color: '#374151', fontSize: 12, textAlign: 'center' }}>
          Channel access is determined by your current rank tier. Earn more rank points to unlock higher channels.
          <br />
          <a href="/rank" style={{ color: '#3b82f6', textDecoration: 'none' }}>
            View your rank →
          </a>
        </div>
      </div>
    </div>
  );
}
