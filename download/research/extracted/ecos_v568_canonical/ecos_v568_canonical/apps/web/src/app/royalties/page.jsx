/**
 * ECOS Royalties — V95
 * Validator earnings history. Auto-refreshes every 15 seconds.
 * Wired to real endpoints:
 *   GET /api/v1/stats          → topValidators leaderboard (top 5)
 *   GET /api/v1/approvals?status=all → individual earnings calculation
 *   GET /api/v1/validator/:id/earnings → per-validator earnings detail
 *   GET /api/v1/patches        → knowledge patches tab
 */
'use client';

import { useState, useEffect, useCallback } from 'react';

const EXPRESS_BASE = process.env.NEXT_PUBLIC_EXPRESS_URL || 'http://localhost:3000';
const DEFAULT_VALIDATOR = 'validator::demo_001';

export default function RoyaltiesPage() {
  const [validatorId, setValidatorId]         = useState(DEFAULT_VALIDATOR);
  const [balance, setBalance]                 = useState(null);
  const [earnings, setEarnings]               = useState([]);
  const [loading, setLoading]                 = useState(false);
  const [lastRefresh, setLastRefresh]         = useState(null);
  const [error, setError]                     = useState(null);
  const [patchesOpen, setPatchesOpen]         = useState(false);
  const [patches, setPatches]                 = useState([]);
  const [patchesLoading, setPatchesLoading]   = useState(false);

  // Leaderboard state (from GET /api/v1/stats)
  const [topValidators, setTopValidators]     = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  // Individual earnings from GET /api/v1/validator/:id/earnings
  const [earningsDetail, setEarningsDetail]   = useState(null);
  const [earningsInput, setEarningsInput]     = useState(DEFAULT_VALIDATOR);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsError, setEarningsError]     = useState(null);

  // ── Fetch leaderboard from /api/v1/stats ─────────────────────────────────
  const fetchLeaderboard = useCallback(async () => {
    setLeaderboardLoading(true);
    try {
      const res  = await fetch(`${EXPRESS_BASE}/api/v1/stats`);
      const data = await res.json();
      setTopValidators(data.topValidators || []);
    } catch (_) {
      setTopValidators([]);
    } finally {
      setLeaderboardLoading(false);
    }
  }, []);

  // ── Fetch individual earnings from /api/v1/validator/:id/earnings ────────
  const fetchEarningsDetail = useCallback(async (vid) => {
    setEarningsLoading(true);
    setEarningsError(null);
    setEarningsDetail(null);
    try {
      const res  = await fetch(`${EXPRESS_BASE}/api/v1/validator/${encodeURIComponent(vid)}/earnings`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setEarningsDetail(data);
    } catch (e) {
      setEarningsError(e.message);
    } finally {
      setEarningsLoading(false);
    }
  }, []);

  // ── Main data fetch: balance + approval history ───────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [balRes, apvRes] = await Promise.all([
        fetch(`${EXPRESS_BASE}/api/v1/account?id=${encodeURIComponent(validatorId)}`),
        fetch(`${EXPRESS_BASE}/api/v1/approvals?status=all&limit=200`),
      ]);
      const balData = await balRes.json();
      const apvData = await apvRes.json();

      setBalance(balData);

      const relevant = (apvData.approvals || []).filter(
        a => a.validatorAccountId === validatorId &&
             (a.decision === 'approve' || a.decision === 'modify')
      );
      setEarnings(relevant);
      setLastRefresh(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [validatorId]);

  useEffect(() => { fetchData(); fetchLeaderboard(); }, [fetchData, fetchLeaderboard]);
  useEffect(() => {
    const t = setInterval(() => { fetchData(); fetchLeaderboard(); }, 15000);
    return () => clearInterval(t);
  }, [fetchData, fetchLeaderboard]);

  const totalEarned = earnings.reduce((sum, a) => {
    const price = parseFloat(a.priceUsd || '0');
    return sum + price * 0.4; // 40% validator share
  }, 0);

  async function fetchPatches() {
    setPatchesLoading(true);
    try {
      const res  = await fetch(`${EXPRESS_BASE}/api/v1/patches?limit=20&sort=reuse_count`);
      const data = await res.json();
      setPatches(data.patches || []);
    } catch (_) {
      setPatches([]);
    } finally {
      setPatchesLoading(false);
    }
  }

  return (
    <div style={S.root}>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>💰 Royalties & Earnings</h1>
          <p style={S.subtitle}>Validator passive income from approved tasks</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastRefresh && <span style={S.refresh}>Last refreshed: {lastRefresh}</span>}
          <button onClick={() => { fetchData(); fetchLeaderboard(); }} disabled={loading} style={S.btn}>
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* ── Top 5 Validators Leaderboard (from GET /api/v1/stats) ─────────── */}
      <div style={S.section}>
        <h2 style={S.sectionTitle}>🏆 Top Validators Leaderboard</h2>
        {leaderboardLoading ? (
          <div style={S.empty}>Loading leaderboard…</div>
        ) : topValidators.length === 0 ? (
          <div style={S.empty}>No validators have earned rewards yet.</div>
        ) : (
          <table style={S.table}>
            <thead>
              <tr>
                {['Rank', 'Validator ID', 'Tasks', 'Total Earned'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topValidators.slice(0, 5).map((v, i) => (
                <tr key={v.validatorId} style={{ background: i % 2 === 0 ? '#111827' : '#0f172a' }}>
                  <td style={{ ...S.td, fontWeight: 700, color: i === 0 ? '#fcd34d' : i === 1 ? '#9ca3af' : i === 2 ? '#b45309' : '#e5e7eb' }}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                  </td>
                  <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12, color: '#93c5fd' }}>
                    {v.validatorId}
                  </td>
                  <td style={S.td}>{v.taskCount}</td>
                  <td style={{ ...S.td, color: '#34d399', fontWeight: 600 }}>${v.earnedUsd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Individual Earnings (GET /api/v1/validator/:id/earnings) ─────── */}
      <div style={S.section}>
        <h2 style={S.sectionTitle}>🔍 Check My Earnings</h2>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <input
            value={earningsInput}
            onChange={e => setEarningsInput(e.target.value)}
            style={S.input}
            placeholder="validator::your_id"
          />
          <button
            onClick={() => fetchEarningsDetail(earningsInput)}
            disabled={earningsLoading}
            style={{ ...S.btn, background: '#1e3a5f', borderColor: '#3b82f6', color: '#93c5fd' }}
          >
            {earningsLoading ? '…' : '💼 Check My Earnings'}
          </button>
        </div>
        {earningsError && (
          <div style={{ ...S.error, marginTop: 12 }}>⚠️ {earningsError}</div>
        )}
        {earningsDetail && (
          <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
            {[
              { label: 'Task Earnings',   value: `$${earningsDetail.taskEarnings}`,   color: '#34d399' },
              { label: 'Royalty Earnings', value: `$${earningsDetail.royaltyEarnings}`, color: '#f9a8d4' },
              { label: 'Total Earned',    value: `$${earningsDetail.totalEarned}`,    color: '#fcd34d' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: '#0f172a', border: '1px solid #1f2937', borderRadius: 8, padding: '14px 18px', textAlign: 'center' }}>
                <div style={{ color, fontSize: 22, fontWeight: 700 }}>{value}</div>
                <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>{label}</div>
                <div style={{ color: '#374151', fontSize: 10, marginTop: 2 }}>{earningsDetail.date || 'today'}</div>
              </div>
            ))}
          </div>
        )}
        {earningsDetail?.resolvedCount !== undefined && (
          <div style={{ marginTop: 8, color: '#6b7280', fontSize: 12 }}>
            {earningsDetail.resolvedCount} approvals resolved · Validator: <code style={S.code}>{earningsDetail.validatorId}</code>
          </div>
        )}
      </div>

      {/* ── Validator selector + per-account history ─────────────────────── */}
      <div style={S.section}>
        <label style={S.label}>Validator ID (history view)</label>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <input
            value={validatorId}
            onChange={e => setValidatorId(e.target.value)}
            style={S.input}
            placeholder="validator::demo_001"
          />
          <button onClick={fetchData} style={S.btn}>Load</button>
        </div>
      </div>

      {error && <div style={S.error}>⚠️ {error}</div>}

      {/* Stats row */}
      <div style={S.statsRow}>
        {[
          { icon: '💼', label: 'Ledger Balance',   value: balance ? `$${balance.balance_usd}` : '—', color: '#34d399' },
          { icon: '✅', label: 'Tasks Validated',   value: earnings.length, color: '#93c5fd' },
          { icon: '📈', label: 'Total Earned (est)', value: `$${totalEarned.toFixed(4)}`, color: '#fcd34d' },
          { icon: '⚡', label: 'Avg per Task',      value: earnings.length ? `$${(totalEarned/earnings.length).toFixed(4)}` : '—', color: '#f9a8d4' },
        ].map(({ icon, label, value, color }) => (
          <div key={label} style={S.statCard}>
            <div style={{ fontSize: 24 }}>{icon}</div>
            <div style={{ color, fontSize: 20, fontWeight: 700, marginTop: 4 }}>{value}</div>
            <div style={S.statLabel}>{label}</div>
          </div>
        ))}
      </div>

      {/* Earnings table */}
      <div style={S.section}>
        <h2 style={S.sectionTitle}>Validation History</h2>
        {earnings.length === 0 ? (
          <div style={S.empty}>
            No validated tasks yet for <code style={S.code}>{validatorId}</code>.
            Resolve approvals in the Validator view to start earning.
          </div>
        ) : (
          <table style={S.table}>
            <thead>
              <tr>
                {['Time', 'Mission', 'Decision', 'Task Price', 'Earned (40%)', 'Approval ID'].map(h => (
                  <th key={h} style={S.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {earnings.slice(0, 50).map((a, i) => {
                const earned = (parseFloat(a.priceUsd || '0') * 0.4).toFixed(4);
                return (
                  <tr key={a.id} style={{ background: i % 2 === 0 ? '#111827' : '#0f172a' }}>
                    <td style={S.td}>{new Date(a.resolvedAt || a.createdAt).toLocaleTimeString()}</td>
                    <td style={{ ...S.td, color: '#93c5fd', fontFamily: 'monospace', fontSize: 11 }}>
                      {(a.missionId || '').slice(0, 20)}…
                    </td>
                    <td style={S.td}>
                      <span style={{
                        background: a.decision === 'approve' ? '#064e3b' : '#78350f',
                        color: a.decision === 'approve' ? '#34d399' : '#fcd34d',
                        padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700
                      }}>
                        {a.decision?.toUpperCase()}
                      </span>
                    </td>
                    <td style={S.td}>${a.priceUsd}</td>
                    <td style={{ ...S.td, color: '#34d399', fontWeight: 600 }}>+${earned}</td>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 10, color: '#6b7280' }}>
                      <a href={`/mission/${a.id}`} style={{ color: '#6b7280' }}>
                        {a.id?.slice(0, 16)}…
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Knowledge Patches */}
      <div style={S.section}>
        <button
          onClick={() => {
            const next = !patchesOpen;
            setPatchesOpen(next);
            if (next && patches.length === 0) fetchPatches();
          }}
          style={{ ...S.btn, width: '100%', textAlign: 'left', fontSize: 15, fontWeight: 600, marginBottom: patchesOpen ? 16 : 0 }}
        >
          📦 Knowledge Patches {patchesOpen ? '▲' : '▼'}
        </button>
        {patchesOpen && (
          patchesLoading ? (
            <div style={S.empty}>Loading patches…</div>
          ) : patches.length === 0 ? (
            <div style={S.empty}>No patches available.</div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr>
                  {['Patch ID', 'Domain', 'Reuses', 'Earned', 'Created'].map(h => (
                    <th key={h} style={S.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {patches.map((p, i) => (
                  <tr key={p.id || i} style={{ background: i % 2 === 0 ? '#111827' : '#0f172a' }}>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 10, color: '#6b7280' }}>
                      {p.id?.slice(0, 16)}…
                    </td>
                    <td style={S.td}>{p.domain || '—'}</td>
                    <td style={S.td}>{p.reuseCount ?? 0}</td>
                    <td style={{ ...S.td, color: '#34d399', fontWeight: 600 }}>{p.earnedUsd || '$0.00'}</td>
                    <td style={S.td}>{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}

const S = {
  root: { background: '#111827', minHeight: '100vh', color: '#e5e7eb',
    fontFamily: '"Inter","Segoe UI",system-ui,sans-serif', padding: '24px 32px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: 24, paddingBottom: 20, borderBottom: '1px solid #1f2937' },
  title: { fontSize: 24, fontWeight: 700, margin: 0 },
  subtitle: { color: '#6b7280', fontSize: 14, marginTop: 4 },
  refresh: { color: '#6b7280', fontSize: 12 },
  btn: { background: '#1f2937', border: '1px solid #374151', borderRadius: 6,
    color: '#e5e7eb', padding: '6px 14px', cursor: 'pointer', fontSize: 13 },
  section: { background: '#0f172a', border: '1px solid #1f2937', borderRadius: 8,
    padding: 20, marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontWeight: 600, margin: '0 0 16px' },
  label: { color: '#9ca3af', fontSize: 12, fontWeight: 500 },
  input: { flex: 1, background: '#1f2937', border: '1px solid #374151', borderRadius: 6,
    color: '#e5e7eb', padding: '6px 12px', fontSize: 14, outline: 'none' },
  statsRow: { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16, marginBottom: 20 },
  statCard: { background: '#0f172a', border: '1px solid #1f2937', borderRadius: 8,
    padding: '16px 20px', textAlign: 'center' },
  statLabel: { color: '#6b7280', fontSize: 12, marginTop: 4 },
  error: { background: '#7f1d1d', border: '1px solid #991b1b', borderRadius: 8,
    padding: '12px 16px', marginBottom: 20, color: '#fca5a5' },
  empty: { color: '#6b7280', textAlign: 'center', padding: '32px 0', fontSize: 14 },
  code: { background: '#374151', borderRadius: 4, padding: '1px 6px',
    fontFamily: 'monospace', color: '#93c5fd', fontSize: 12 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 12px', color: '#6b7280', fontSize: 12,
    fontWeight: 500, borderBottom: '1px solid #1f2937' },
  td: { padding: '10px 12px', color: '#e5e7eb', borderBottom: '1px solid #111827' },
};
