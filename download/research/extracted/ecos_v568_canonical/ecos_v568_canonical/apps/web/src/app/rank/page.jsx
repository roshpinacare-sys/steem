'use client';
/**
 * Rank & Rewards Dashboard — ECOS V133
 * ─────────────────────────────────────────────────────────────────────────────
 * [V133-RANK-UI] Tiered user ranking visualization.
 *
 * Shows:
 *   - Tier ladder (Observer → Sovereign)
 *   - Live leaderboard
 *   - User rank lookup by userId
 *   - System distribution stats
 *   - Communication access levels per tier
 */

import { useState, useEffect, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtNum(n) {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString();
}

const TIER_COLORS = {
  OBSERVER:    { bg: '#111827', border: '#374151', accent: '#6b7280', text: '#9ca3af' },
  MEMBER:      { bg: '#0f2318', border: '#166534', accent: '#22c55e', text: '#4ade80' },
  CONTRIBUTOR: { bg: '#0f1b2d', border: '#1d4ed8', accent: '#3b82f6', text: '#60a5fa' },
  VALIDATOR:   { bg: '#1a0f2e', border: '#7c3aed', accent: '#8b5cf6', text: '#a78bfa' },
  STEWARD:     { bg: '#1c1003', border: '#d97706', accent: '#f59e0b', text: '#fbbf24' },
  SOVEREIGN:   { bg: '#1a0a00', border: '#c2410c', accent: '#f97316', text: '#fb923c' },
};

// ── data hooks ────────────────────────────────────────────────────────────────

function useRankData() {
  const [stats,       setStats]       = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, lbRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/rank/stats`).catch(() => null),
        fetch(`${API_BASE}/api/v1/rank/leaderboard?limit=20`).catch(() => null),
      ]);
      if (statsRes?.ok)       setStats(await statsRes.json());
      if (lbRes?.ok)          setLeaderboard(await lbRes.json());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  return { stats, leaderboard, loading, error, refetch: fetchAll };
}

// ── sub-components ────────────────────────────────────────────────────────────

function TierCard({ tier, count }) {
  const c = TIER_COLORS[tier.id] || TIER_COLORS.OBSERVER;
  return (
    <div style={{
      background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10,
      padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 20 }}>{tier.emoji}</div>
        {tier.rewardEligible && (
          <span style={{ fontSize: 10, fontWeight: 700, background: '#14532d', color: '#4ade80', padding: '2px 7px', borderRadius: 99 }}>
            REWARDS ✓
          </span>
        )}
      </div>
      <div style={{ fontWeight: 700, fontSize: 15, color: c.text }}>{tier.label}</div>
      <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>{tier.description}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 4 }}>
        <span style={{ color: '#6b7280' }}>Min score</span>
        <span style={{ color: c.accent, fontWeight: 700 }}>{fmtNum(tier.minScore)}</span>
      </div>
      {count !== undefined && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
          <span style={{ color: '#6b7280' }}>Users</span>
          <span style={{ color: '#e5e7eb', fontWeight: 600 }}>{fmtNum(count)}</span>
        </div>
      )}
    </div>
  );
}

function LeaderboardRow({ entry, rank }) {
  const c = TIER_COLORS[entry.tier] || TIER_COLORS.OBSERVER;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 16px', borderBottom: '1px solid #1f2937',
      background: rank <= 3 ? '#0d1117' : 'transparent',
    }}>
      <div style={{ width: 28, fontSize: 14, color: rank <= 3 ? '#f59e0b' : '#6b7280', fontWeight: 700, textAlign: 'center' }}>
        {rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : `#${rank}`}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#e5e7eb' }}>{entry.userId}</div>
        <div style={{ fontSize: 11, color: c.text, marginTop: 2 }}>
          {entry.tierEmoji} {entry.tier} {entry.rewardEligible && '· rewards eligible'}
        </div>
      </div>
      <div style={{ fontWeight: 700, color: c.accent, fontSize: 15 }}>{fmtNum(entry.score)}</div>
    </div>
  );
}

function UserLookup() {
  const [userId,  setUserId]  = useState('');
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState(null);

  async function lookup() {
    if (!userId.trim()) return;
    setLoading(true); setErr(null); setProfile(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/rank/users/${encodeURIComponent(userId.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setProfile(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  const c = profile ? (TIER_COLORS[profile.tier?.id] || TIER_COLORS.OBSERVER) : null;

  return (
    <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#e5e7eb', marginBottom: 12 }}>
        🔍 User Rank Lookup
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          value={userId}
          onChange={e => setUserId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !loading && lookup()}
          placeholder="Enter userId…"
          disabled={loading}
          style={{
            flex: 1, padding: '8px 12px', borderRadius: 6,
            border: '1px solid #374151', background: '#0f172a',
            color: '#e5e7eb', fontSize: 13, outline: 'none',
          }}
        />
        <button
          onClick={lookup}
          disabled={loading || !userId.trim()}
          style={{
            padding: '8px 16px', borderRadius: 6, border: 'none',
            background: loading ? '#374151' : '#2563eb',
            color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {loading ? '…' : 'Lookup'}
        </button>
      </div>
      {err && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>⚠ {err}</div>}
      {profile && c && (
        <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 24 }}>{profile.tier?.emoji}</span>
            <div>
              <div style={{ fontWeight: 700, color: c.text, fontSize: 16 }}>{profile.tier?.label}</div>
              <div style={{ fontSize: 12, color: '#6b7280', fontFamily: 'monospace' }}>{profile.userId}</div>
            </div>
            {profile.rewardEligible && (
              <span style={{ marginLeft: 'auto', fontSize: 10, background: '#14532d', color: '#4ade80', padding: '3px 8px', borderRadius: 99, fontWeight: 700 }}>
                REWARDS ELIGIBLE
              </span>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
            {[
              { label: 'Score', value: fmtNum(profile.score) },
              { label: 'Multiplier', value: `${profile.rewardMultiplier}×` },
              { label: 'Flags', value: profile.flags || 0 },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: '#0f172a', borderRadius: 6, padding: '8px 12px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: c.accent }}>{value}</div>
              </div>
            ))}
          </div>
          {profile.progression && profile.progression.nextTier && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>
                Progress to {profile.progression.nextTier.emoji} {profile.progression.nextTier.label}
                ({fmtNum(profile.progression.pointsToNext)} pts needed)
              </div>
              <div style={{ background: '#1f2937', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                <div style={{ width: `${profile.progression.pct}%`, height: '100%', background: c.accent, borderRadius: 4, transition: 'width 0.4s ease' }} />
              </div>
            </div>
          )}
          <div style={{ borderTop: '1px solid #1f2937', paddingTop: 10 }}>
            <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>
              📡 Communication Access — {profile.communication?.label}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(profile.communication?.channels || []).map(ch => (
                <span key={ch} style={{ fontSize: 11, background: '#1f2937', color: '#60a5fa', padding: '2px 8px', borderRadius: 99, fontFamily: 'monospace' }}>
                  {ch === '*' ? '⭐ all channels' : ch}
                </span>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: '#374151', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            🔑 {profile.rankToken}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RankDashboard() {
  const { stats, leaderboard, loading, error, refetch } = useRankData();

  return (
    <div style={{ minHeight: 'calc(100vh - 56px)', background: '#0f172a', overflowY: 'auto' }}>

      {/* Header */}
      <div style={{ padding: '32px 40px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#e5e7eb', margin: 0 }}>
            🏆 Rank & Rewards
          </h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4, maxWidth: 560 }}>
            The reward system is exclusive — only identified, ranked users earn rewards.
            Rank is earned through contribution. Anti-spam signals can downrank.
          </p>
        </div>
        <button
          onClick={refetch}
          disabled={loading}
          style={{ padding: '5px 14px', borderRadius: 6, border: '1px solid #374151', background: '#1f2937', color: '#9ca3af', cursor: 'pointer', fontSize: 13 }}
        >
          {loading ? '⏳' : '↺ Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ margin: '16px 40px 0', padding: '10px 16px', background: '#7f1d1d', color: '#fca5a5', borderRadius: 8, fontSize: 13 }}>
          ⚠ {error}
        </div>
      )}

      <div style={{ padding: '24px 40px 40px', display: 'flex', flexDirection: 'column', gap: 32 }}>

        {/* Stats overview */}
        {stats && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 18 }}>📊</span>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: '#e5e7eb', margin: 0 }}>System Overview</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 28 }}>
              {[
                { label: 'Total Users',      value: fmtNum(stats.totalUsers),     accent: '#3b82f6' },
                { label: 'Reward Eligible',  value: fmtNum(stats.rewardEligible), accent: '#4ade80' },
                { label: 'Tier Levels',      value: stats.tiers?.length || 6,     accent: '#f59e0b' },
                { label: 'Rank Log Entries', value: fmtNum(stats.rankLogEntries), accent: '#8b5cf6' },
              ].map(({ label, value, accent }) => (
                <div key={label} style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, padding: '14px 18px' }}>
                  <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: accent }}>{value ?? '—'}</div>
                </div>
              ))}
            </div>

            {/* Tier ladder */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 18 }}>🪜</span>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: '#e5e7eb', margin: 0 }}>Tier Ladder</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
              {(stats.tiers || []).map(tier => (
                <TierCard key={tier.id} tier={tier} count={stats.tierDistribution?.[tier.id]} />
              ))}
            </div>
          </div>
        )}

        {/* Leaderboard + Lookup */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

          {/* Leaderboard */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 18 }}>🏅</span>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: '#e5e7eb', margin: 0 }}>Top Contributors</h2>
            </div>
            <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 10, overflow: 'hidden' }}>
              {!leaderboard || leaderboard.leaderboard?.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
                  No ranked users yet. Start contributing!
                </div>
              ) : (
                leaderboard.leaderboard.map((entry, i) => (
                  <LeaderboardRow key={entry.userId} entry={entry} rank={i + 1} />
                ))
              )}
            </div>
          </div>

          {/* User lookup */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 18 }}>🎖️</span>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: '#e5e7eb', margin: 0 }}>Rank Lookup</h2>
            </div>
            <UserLookup />
          </div>
        </div>

      </div>

      {/* Footer */}
      <div style={{ padding: '12px 40px', fontSize: 12, color: '#374151', borderTop: '1px solid #1f2937' }}>
        ECOS Rank & Rewards · V133 · Rewards are non-transferable and tied to verified identity
      </div>
    </div>
  );
}
