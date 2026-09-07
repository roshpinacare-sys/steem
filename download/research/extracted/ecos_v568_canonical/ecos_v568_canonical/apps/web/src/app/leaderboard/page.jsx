'use client';
/**
 * Validator Leaderboard Page — V149
 * ─────────────────────────────────────────────────────────────────────────────
 * [V149-LB] Upgraded leaderboard with three tabs:
 *   1. Validators  — /api/v1/validators/leaderboard (accuracy/volume/earnings)
 *   2. Community   — /api/v1/community/leaderboard?by=royalties|validations|level
 *   3. Rank        — /api/v1/rank/leaderboard (rank-tier system)
 *
 * Features vs V99:
 *   - Three data sources unified in one UI
 *   - Real "New This Week" section from live data (no hardcoded UUIDs)
 *   - Sort toggle on Community tab (royalties / validations / level)
 *   - Rank-tier badges (OBSERVER→STEWARD) with tier color map
 *   - Auto-refresh every 30s with manual refresh button
 *   - Empty state per tab
 *   - No external dependencies — inline styles only
 */

import { useEffect, useState, useCallback } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ── Tier colour map (matches rank system) ─────────────────────────────────────
const TIER_STYLES = {
  OBSERVER:    { bg: '#1e293b', color: '#94a3b8' },
  MEMBER:      { bg: '#1e3a5f', color: '#60a5fa' },
  CONTRIBUTOR: { bg: '#14532d', color: '#4ade80' },
  VALIDATOR:   { bg: '#3b1f6e', color: '#a78bfa' },
  STEWARD:     { bg: '#7f1d1d', color: '#fca5a5' },
};
function tierStyle(tier) {
  return TIER_STYLES[tier] || TIER_STYLES.OBSERVER;
}

function scoreBadge(score) {
  if (score >= 80) return { bg: '#14532d', color: '#4ade80', label: '🟢' };
  if (score >= 50) return { bg: '#713f12', color: '#fbbf24', label: '🟡' };
  return { bg: '#7f1d1d', color: '#f87171', label: '🔴' };
}

function medal(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return `#${rank}`;
}

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

function isThisWeek(iso) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < 7 * 24 * 60 * 60 * 1000;
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = ['Validators', 'Community', 'Rank'];


// ── [V154-LB] Extended earnings leaderboard ───────────────────────────────────
function EarningsTab({ data, loading }) {
  if (loading) return <p style={{ color: '#64748b', padding: 20 }}>Loading…</p>;
  if (!data || data.length === 0)
    return <p style={{ color: '#475569', padding: 20, textAlign: 'center' }}>No earnings data yet.</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '8px 12px', color: '#94a3b8', borderBottom: '1px solid #334155' }}>#</th>
            <th style={{ textAlign: 'left', padding: '8px 12px', color: '#94a3b8', borderBottom: '1px solid #334155' }}>Validator</th>
            <th style={{ textAlign: 'right', padding: '8px 12px', color: '#94a3b8', borderBottom: '1px solid #334155' }}>Earned (USD)</th>
          </tr>
        </thead>
        <tbody>
          {data.map((e, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
              <td style={{ padding: '8px 12px', color: '#94a3b8' }}>{medal(i + 1)}</td>
              <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, color: '#a5b4fc' }}>
                {(e.validatorId || '').slice(0, 22)}…
              </td>
              <td style={{ padding: '8px 12px', textAlign: 'right', color: '#34d399', fontWeight: 700 }}>
                ${parseFloat(e.earned || 0).toFixed(4)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LeaderboardPage() {
  const [tab,        setTab]        = useState('Validators');
  const [validators, setValidators] = useState([]);
  const [community,  setCommunity]  = useState([]);
  const [rankBoard,  setRankBoard]  = useState([]);
  const [communitySort, setCommunitySort] = useState('royalties');
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchAll = useCallback(async (sort = communitySort) => {
    setLoading(true);
    setError(null);
    try {
      const [vRes, cRes, rRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/validators/leaderboard?limit=20`),
        fetch(`${API_BASE}/api/v1/community/leaderboard?by=${sort}&limit=20`),
        fetch(`${API_BASE}/api/v1/rank/leaderboard?limit=20`),
      ]);
      if (vRes.ok) { const d = await vRes.json(); setValidators(d.validators || []); }
      if (cRes.ok) { const d = await cRes.json(); setCommunity(d.leaderboard || []); }
      if (rRes.ok) { const d = await rRes.json(); setRankBoard(d.leaderboard || []); }
      setLastUpdate(new Date().toISOString());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [communitySort]);

  useEffect(() => {
    fetchAll();
    const id = setInterval(() => fetchAll(), 30000);
    return () => clearInterval(id);
  }, [fetchAll]);

  // Re-fetch community tab when sort changes
  const handleSortChange = (s) => {
    setCommunitySort(s);
    fetch(`${API_BASE}/api/v1/community/leaderboard?by=${s}&limit=20`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setCommunity(d.leaderboard || []))
      .catch(() => {});
  };

  // "New this week" — pulled from live validator data
  const newThisWeek = validators.filter(v => isThisWeek(v.createdAt || v.lastActiveAt));

  return (
    <div style={pageStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <h1 style={titleStyle}>🏆 ECOS Leaderboard</h1>
        <p style={subtitleStyle}>Top contributors ranked by accuracy, earnings, and community impact</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {lastUpdate && (
            <p style={refreshStyle}>
              <span style={{ color: '#22c55e' }}>●</span>
              {' '}Auto-refreshes every 30s · Last: {timeAgo(lastUpdate)}
            </p>
          )}
          <button onClick={() => fetchAll(communitySort)} style={refreshBtnStyle}>↺ Refresh</button>
        </div>
      </div>

      {/* Error */}
      {error && <div style={errorStyle}>⚠️ {error}</div>}

      {/* Tab Bar */}
      <div style={tabBarStyle}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={tabBtnStyle(t === tab)}>
            {t === 'Validators' ? '🔍 ' : t === 'Community' ? '👥 ' : '⭐ '}
            {t}
          </button>
        ))}
        {tab === 'Community' && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ color: '#6b7280', fontSize: 12 }}>Sort by:</span>
            {['royalties','validations','level'].map(s => (
              <button key={s} onClick={() => handleSortChange(s)}
                style={{ ...sortBtnStyle, ...(communitySort === s ? sortBtnActive : {}) }}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && <div style={loadingStyle}>Loading…</div>}

      {/* ── Validators Tab ─────────────────────────────────────────── */}
      {!loading && tab === 'Validators' && (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {['Rank','Validator ID','Score','Stage','Tasks','Approved','Earnings','Last Active'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {validators.length === 0 ? (
                <tr><td colSpan={8} style={emptyCellStyle}>No validators yet. Submit and resolve some tasks to appear here.</td></tr>
              ) : validators.map((v, i) => {
                const badge = scoreBadge(v.score);
                return (
                  <tr key={v.validatorId} style={i % 2 === 0 ? rowEvenStyle : rowOddStyle}>
                    <td style={{ ...tdStyle, fontWeight: 700, color: '#9ca3af' }}>{medal(v.rank || i + 1)}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', color: '#e5e7eb', fontSize: 13 }}>{v.validatorId}</td>
                    <td style={tdStyle}>
                      <span style={{ display:'inline-block', background: badge.bg, color: badge.color, borderRadius: 6, padding: '3px 10px', fontWeight: 700, fontSize: 13 }}>
                        {badge.label} {v.score}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, fontSize: 12 }}>
                      <span style={{ background: {'USE':'#e0f2fe','VERIFY':'#dcfce7','OWN':'#fef9c3','RECRUIT':'#fce7f3','MENTOR':'#ede9fe'}[v.graduationStage||'USE'] || '#f3f4f6', color: {'USE':'#0369a1','VERIFY':'#166534','OWN':'#854d0e','RECRUIT':'#9d174d','MENTOR':'#5b21b6'}[v.graduationStage||'USE'] || '#374151', padding: '2px 8px', borderRadius: 5, fontWeight: 600 }}>
                        {v.graduationStage || 'USE'}
                      </span>
                    </td>
                    <td style={tdStyle}>{v.totalTasks}</td>
                    <td style={{ ...tdStyle, color: '#4ade80' }}>{v.approved}</td>
                    <td style={{ ...tdStyle, color: '#fbbf24' }}>${(v.totalEarned || 0).toFixed(2)}</td>
                    <td style={{ ...tdStyle, color: '#6b7280', fontSize: 12 }}>{timeAgo(v.lastActiveAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Community Tab ─────────────────────────────────────────── */}
      {!loading && tab === 'Community' && (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {['Rank','User ID','Level','Royalties ⊙','Validations','Referrals'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {community.length === 0 ? (
                <tr><td colSpan={6} style={emptyCellStyle}>No community data yet.</td></tr>
              ) : community.map((u, i) => (
                <tr key={u.userId || u.id || i} style={i % 2 === 0 ? rowEvenStyle : rowOddStyle}>
                  <td style={{ ...tdStyle, fontWeight: 700, color: '#9ca3af' }}>{medal(i + 1)}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', color: '#e5e7eb', fontSize: 13 }}>{u.userId || u.id || '—'}</td>
                  <td style={{ ...tdStyle, fontSize: 12 }}>
                    <span style={{ background: '#1e3a5f', color: '#60a5fa', padding: '2px 8px', borderRadius: 5, fontWeight: 600 }}>
                      Lv {u.level || 1}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, color: '#fbbf24' }}>⊙ {(u.royaltiesEarned || u.royalties || 0).toLocaleString()}</td>
                  <td style={{ ...tdStyle, color: '#4ade80' }}>{u.validationCount || u.validations || 0}</td>
                  <td style={{ ...tdStyle, color: '#a78bfa' }}>{u.referralCount || u.referrals || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Rank Tab ──────────────────────────────────────────────── */}
      {!loading && tab === 'Rank' && (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr>
                {['Rank','User ID','Tier','Score','Tasks','Streak'].map(h => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rankBoard.length === 0 ? (
                <tr><td colSpan={6} style={emptyCellStyle}>No rank data yet.</td></tr>
              ) : rankBoard.map((u, i) => {
                const ts = tierStyle(u.tier);
                return (
                  <tr key={u.userId || i} style={i % 2 === 0 ? rowEvenStyle : rowOddStyle}>
                    <td style={{ ...tdStyle, fontWeight: 700, color: '#9ca3af' }}>{medal(i + 1)}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', color: '#e5e7eb', fontSize: 13 }}>{u.userId || '—'}</td>
                    <td style={{ ...tdStyle }}>
                      <span style={{ background: ts.bg, color: ts.color, padding: '2px 8px', borderRadius: 5, fontWeight: 600, fontSize: 12 }}>
                        {u.tier || 'OBSERVER'}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: '#f1f5f9', fontWeight: 700 }}>{u.score ?? u.rankScore ?? '—'}</td>
                    <td style={{ ...tdStyle, color: '#4ade80' }}>{u.tasksCompleted ?? u.tasks ?? 0}</td>
                    <td style={{ ...tdStyle, color: '#fb923c' }}>
                      {u.currentStreak ? `🔥 ${u.currentStreak}d` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* New This Week — live data */}
      {!loading && tab === 'Validators' && (
        <div style={newThisWeekStyle}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#f1f5f9', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            🔥 New Validators This Week
          </h2>
          {newThisWeek.length === 0 ? (
            <p style={{ color: '#6b7280', fontSize: 14 }}>No new validators this week yet. Be the first!</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              {newThisWeek.map(v => (
                <div key={v.validatorId} style={newCardStyle}>
                  <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#60a5fa', fontWeight: 'bold', marginBottom: 8, wordBreak: 'break-all' }}>
                    {v.validatorId}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8' }}>
                    <span>Earned: ⊙{(v.totalEarned || 0).toFixed(2)}</span>
                    <span style={{ color: '#10b981', fontWeight: 600 }}>{v.totalTasks || 0} tasks</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const pageStyle        = { minHeight: '100vh', background: '#0f172a', color: '#e5e7eb', padding: '32px 24px', maxWidth: 1200, margin: '0 auto' };
const headerStyle      = { marginBottom: 24 };
const titleStyle       = { fontSize: 28, fontWeight: 800, color: '#f1f5f9', marginBottom: 6 };
const subtitleStyle    = { fontSize: 15, color: '#94a3b8', marginBottom: 8 };
const refreshStyle     = { fontSize: 12, color: '#475569', display: 'inline' };
const refreshBtnStyle  = { background: '#1e293b', color: '#60a5fa', border: '1px solid #334155', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 13 };
const errorStyle       = { background: '#7f1d1d', color: '#fca5a5', borderRadius: 8, padding: '12px 16px', marginBottom: 24 };
const loadingStyle     = { color: '#6b7280', padding: '40px 0', textAlign: 'center' };
const tabBarStyle      = { display: 'flex', gap: 8, marginBottom: 24, alignItems: 'center', flexWrap: 'wrap' };
const tabBtnStyle = (active) => ({
  background:   active ? '#1d4ed8' : '#1e293b',
  color:        active ? '#fff' : '#94a3b8',
  border:       active ? '1px solid #3b82f6' : '1px solid #334155',
  borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 14, fontWeight: active ? 700 : 400,
});
const sortBtnStyle  = { background: '#1e293b', color: '#6b7280', border: '1px solid #334155', borderRadius: 5, padding: '3px 10px', cursor: 'pointer', fontSize: 12 };
const sortBtnActive = { background: '#334155', color: '#f1f5f9', fontWeight: 600 };
const tableWrapStyle   = { overflowX: 'auto', borderRadius: 12, border: '1px solid #1e293b' };
const tableStyle       = { width: '100%', borderCollapse: 'collapse', fontSize: 14 };
const thStyle          = { background: '#1e293b', color: '#94a3b8', fontWeight: 600, textAlign: 'left', padding: '12px 16px', fontSize: 12, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #334155' };
const tdStyle          = { padding: '12px 16px', borderBottom: '1px solid #1e293b', color: '#d1d5db', verticalAlign: 'middle' };
const rowEvenStyle     = { background: '#0f172a' };
const rowOddStyle      = { background: '#111827' };
const emptyCellStyle   = { ...tdStyle, textAlign: 'center', color: '#6b7280', padding: '40px 0' };
const newThisWeekStyle = { marginTop: 40, background: '#1e293b', borderRadius: 12, padding: 24, border: '1px solid #334155' };
const newCardStyle     = { background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: 16 };
