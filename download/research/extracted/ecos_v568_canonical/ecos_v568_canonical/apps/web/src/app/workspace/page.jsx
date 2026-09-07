/**
 * ECOS Workspace UI — V155
 * ─────────────────────────────────────────────────────────────────────────────
 * [V155-WS-UI] Multi-Tenant Workspace UI
 *
 * Surfaces the lib/workspaceRegistry.js backend:
 *   - List active workspaces (filterable by visibility)
 *   - Create new workspace (name, description, visibility)
 *   - Per-workspace task statistics
 *   - Workspace leaderboard
 *
 * Uses existing API endpoints:
 *   GET  /api/v1/workspaces
 *   POST /api/v1/workspaces
 *   GET  /api/v1/workspaces/:id/stats  (V155 new)
 *   GET  /api/v1/workspace/stats
 *   GET  /api/v1/users/leaderboard
 *
 * Sacred files (fiatLedger.js, auditLog.js) are NEVER touched.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';

const EXPRESS_BASE =
  typeof window !== 'undefined' && window.__ECOS_EXPRESS_URL__
    ? window.__ECOS_EXPRESS_URL__
    : (process.env.NEXT_PUBLIC_EXPRESS_URL || 'http://localhost:3000');

async function fetchJson(path, opts = {}) {
  try {
    const r = await fetch(`${EXPRESS_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      ...opts,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) { return { __error: e.message }; }
}

// ── Pure helpers (unit-tested) ─────────────────────────────────────────────────

export function visibilityBadge(visibility) {
  switch (visibility) {
    case 'public':  return { label: '🌐 Public',  color: '#34d399', bg: '#064e3b' };
    case 'shared':  return { label: '👥 Shared',  color: '#fbbf24', bg: '#78350f' };
    case 'private': return { label: '🔒 Private', color: '#94a3b8', bg: '#1e293b' };
    default:        return { label: visibility || 'unknown', color: '#94a3b8', bg: '#1e293b' };
  }
}

export function formatScore(score) {
  if (score == null) return '—';
  const s = parseInt(score);
  if (s >= 80) return { label: `${s}`, color: '#34d399' };
  if (s >= 50) return { label: `${s}`, color: '#fbbf24' };
  return { label: `${s}`, color: '#f87171' };
}

export function workspaceAge(createdAt) {
  if (!createdAt) return '—';
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

// ── Styles ──────────────────────────────────────────────────────────────────
const S = {
  page: { minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui,sans-serif' },
  header: { background: '#1e293b', borderBottom: '1px solid #334155', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 20, fontWeight: 700, color: '#f1f5f9', margin: 0 },
  body: { padding: '24px 32px', maxWidth: 1200, margin: '0 auto' },
  section: { background: '#1e293b', borderRadius: 10, padding: 20, marginBottom: 20, border: '1px solid #334155' },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 16px 0' },
  btn: { padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnPrimary: { background: '#1d4ed8', color: '#fff' },
  btnSecondary: { background: '#334155', color: '#cbd5e1' },
  btnSuccess: { background: '#064e3b', color: '#6ee7b7' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 12px', color: '#94a3b8', borderBottom: '1px solid #334155', fontWeight: 600 },
  td: { padding: '8px 12px', borderBottom: '1px solid #1e293b', color: '#e2e8f0' },
  input: { background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '8px 12px', color: '#e2e8f0', fontSize: 13, width: '100%', boxSizing: 'border-box' },
  label: { display: 'block', fontSize: 12, color: '#64748b', marginBottom: 4 },
  mono: { fontFamily: 'monospace', fontSize: 12, color: '#a5b4fc' },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 },
  statCard: { background: '#0f172a', borderRadius: 8, padding: '14px 18px', border: '1px solid #334155' },
  statVal: { fontSize: 28, fontWeight: 700, color: '#f1f5f9' },
  statLabel: { fontSize: 12, color: '#64748b', marginTop: 2 },
  wsCard: {
    background: '#0f172a', borderRadius: 8, padding: 16, border: '1px solid #334155',
    cursor: 'pointer', transition: 'border-color 0.2s',
  },
  wsCardActive: { borderColor: '#3b82f6' },
  row: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  badge: (bg, color) => ({ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: bg, color }),
  formGroup: { marginBottom: 14 },
  select: { background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '8px 12px', color: '#e2e8f0', fontSize: 13, width: '100%' },
};

// ── Section: Platform Stats ───────────────────────────────────────────────────
function WorkspacePlatformStats() {
  const [stats, setStats] = useState(null);
  const load = useCallback(async () => {
    const d = await fetchJson('/api/v1/workspace/stats');
    setStats(d.__error ? null : d);
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div style={S.section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={S.sectionTitle}>Workspace Platform Overview</p>
        <button style={{ ...S.btn, ...S.btnSecondary }} onClick={load}>↻ Refresh</button>
      </div>
      {!stats ? (
        <p style={{ color: '#64748b', fontSize: 13 }}>Loading stats…</p>
      ) : (
        <div style={S.grid3}>
          <div style={S.statCard}>
            <div style={{ ...S.statVal, color: '#60a5fa' }}>{stats.workspace?.workspaceCount ?? '—'}</div>
            <div style={S.statLabel}>Total Workspaces</div>
          </div>
          <div style={S.statCard}>
            <div style={{ ...S.statVal, color: '#a78bfa' }}>{stats.workspace?.userCount ?? '—'}</div>
            <div style={S.statLabel}>Registered Users</div>
          </div>
          <div style={S.statCard}>
            <div style={{ ...S.statVal, color: '#34d399' }}>{stats.journal?.runCount ?? '—'}</div>
            <div style={S.statLabel}>Agent Runs</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section: Create Workspace ─────────────────────────────────────────────────
function CreateWorkspaceForm({ onCreated }) {
  const [form, setForm] = useState({ ownerId: '', name: '', description: '', visibility: 'private' });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    if (!form.ownerId.trim()) { setError('Owner ID is required'); return; }
    if (!form.name.trim())    { setError('Name is required'); return; }
    setLoading(true);
    setError('');
    const d = await fetchJson('/api/v1/workspaces', {
      method: 'POST',
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (d.__error) {
      setError(d.__error);
    } else {
      setMsg(`Workspace "${d.workspace?.name || form.name}" created!`);
      setForm({ ownerId: '', name: '', description: '', visibility: 'private' });
      onCreated && onCreated(d.workspace);
      setTimeout(() => setMsg(''), 5000);
    }
  };

  return (
    <div style={S.section}>
      <p style={S.sectionTitle}>Create New Workspace</p>
      <div style={S.grid3}>
        <div style={S.formGroup}>
          <label style={S.label}>Owner ID *</label>
          <input style={S.input} value={form.ownerId}
            onChange={e => setForm(f => ({ ...f, ownerId: e.target.value }))}
            placeholder="user::abc123 or email" />
        </div>
        <div style={S.formGroup}>
          <label style={S.label}>Workspace Name *</label>
          <input style={S.input} value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="My Workspace" />
        </div>
        <div style={S.formGroup}>
          <label style={S.label}>Visibility</label>
          <select style={S.select} value={form.visibility}
            onChange={e => setForm(f => ({ ...f, visibility: e.target.value }))}>
            <option value="private">🔒 Private</option>
            <option value="shared">👥 Shared</option>
            <option value="public">🌐 Public</option>
          </select>
        </div>
      </div>
      <div style={S.formGroup}>
        <label style={S.label}>Description (optional)</label>
        <input style={S.input} value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder="Describe this workspace…" />
      </div>
      {error && <p style={{ color: '#f87171', fontSize: 13, margin: '8px 0' }}>{error}</p>}
      {msg   && <p style={{ color: '#86efac', fontSize: 13, margin: '8px 0' }}>{msg}</p>}
      <button style={{ ...S.btn, ...S.btnPrimary }} onClick={submit} disabled={loading}>
        {loading ? 'Creating…' : '+ Create Workspace'}
      </button>
    </div>
  );
}

// ── Section: Workspace List ───────────────────────────────────────────────────
function WorkspaceList() {
  const [workspaces, setWorkspaces] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [wsStats, setWsStats] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const d = await fetchJson('/api/v1/workspaces');
    setWorkspaces(d.__error ? [] : (d.workspaces || []));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadWsStats = async (wsId) => {
    setSelected(wsId);
    const d = await fetchJson(`/api/v1/workspaces/${wsId}/stats`);
    setWsStats(d.__error ? null : d);
  };

  const filtered = workspaces.filter(ws =>
    !filter || ws.visibility === filter || ws.name?.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div style={S.section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={S.sectionTitle}>Active Workspaces ({filtered.length})</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <select style={{ ...S.select, width: 'auto' }} value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="">All</option>
            <option value="public">Public</option>
            <option value="shared">Shared</option>
            <option value="private">Private</option>
          </select>
          <button style={{ ...S.btn, ...S.btnSecondary }} onClick={load}>{loading ? '…' : '↻ Refresh'}</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p style={{ color: '#64748b', fontSize: 13 }}>No workspaces yet. Create one above.</p>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Name</th>
              <th style={S.th}>Owner</th>
              <th style={S.th}>Visibility</th>
              <th style={S.th}>Created</th>
              <th style={S.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ws, i) => {
              const vb = visibilityBadge(ws.visibility);
              return (
                <tr key={i} style={{ background: selected === ws.workspaceId ? '#0f172a' : 'transparent' }}>
                  <td style={S.td}>
                    <span style={{ fontWeight: 600, color: '#f1f5f9' }}>{ws.name}</span>
                    {ws.description && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{ws.description}</div>}
                  </td>
                  <td style={{ ...S.td, ...S.mono }}>{String(ws.ownerId || '—').slice(0, 20)}</td>
                  <td style={S.td}>
                    <span style={S.badge(vb.bg, vb.color)}>{vb.label}</span>
                  </td>
                  <td style={{ ...S.td, color: '#64748b', fontSize: 12 }}>{workspaceAge(ws.createdAt)}</td>
                  <td style={S.td}>
                    <button style={{ ...S.btn, ...S.btnSecondary, padding: '4px 10px', fontSize: 11 }}
                      onClick={() => loadWsStats(ws.workspaceId)}>
                      📊 Stats
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Workspace detail panel */}
      {selected && wsStats && (
        <div style={{ marginTop: 20, background: '#0f172a', borderRadius: 8, padding: 16, border: '1px solid #334155' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
              Workspace Details: {wsStats.stats?.name || selected}
            </p>
            <button style={{ ...S.btn, ...S.btnSecondary, padding: '4px 10px', fontSize: 11 }}
              onClick={() => { setSelected(null); setWsStats(null); }}>✕ Close</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
            {[
              { label: 'Agents', value: wsStats.stats?._agentIds?.length ?? 0 },
              { label: 'Collaborators', value: wsStats.stats?.collaboratorCount ?? 0 },
              { label: 'Templates', value: wsStats.stats?._templates?.length ?? 0 },
              { label: 'Plugins', value: wsStats.stats?._plugins?.length ?? 0 },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: '#1e293b', borderRadius: 6, padding: '10px 14px', border: '1px solid #334155' }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>{value}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{label}</div>
              </div>
            ))}
          </div>
          {wsStats.stats?.description && (
            <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 12 }}>{wsStats.stats.description}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Section: Contribution Leaderboard ────────────────────────────────────────
function ContributionLeaderboard() {
  const [board, setBoard] = useState([]);
  const load = useCallback(async () => {
    const d = await fetchJson('/api/v1/users/leaderboard?limit=10');
    setBoard(d.__error ? [] : (d.leaderboard || []));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div style={S.section}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <p style={S.sectionTitle}>Contribution Leaderboard (Top 10)</p>
        <button style={{ ...S.btn, ...S.btnSecondary }} onClick={load}>↻ Refresh</button>
      </div>
      {board.length === 0 ? (
        <p style={{ color: '#64748b', fontSize: 13 }}>No users yet.</p>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>#</th>
              <th style={S.th}>User</th>
              <th style={S.th}>Score</th>
              <th style={S.th}>Workspaces</th>
              <th style={S.th}>Last Active</th>
            </tr>
          </thead>
          <tbody>
            {board.map((u, i) => {
              const sc = formatScore(u.score);
              return (
                <tr key={i}>
                  <td style={{ ...S.td, color: i < 3 ? '#fbbf24' : '#64748b', fontWeight: 700 }}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                  </td>
                  <td style={S.td}>
                    <span style={{ fontWeight: 600 }}>{u.name || 'Anonymous'}</span>
                    <div style={{ ...S.mono, fontSize: 11, color: '#475569' }}>{String(u.userId || '').slice(0, 20)}</div>
                  </td>
                  <td style={{ ...S.td, color: sc.color, fontWeight: 700 }}>{sc.label}</td>
                  <td style={S.td}>{u.workspaceIds?.length ?? 0}</td>
                  <td style={{ ...S.td, color: '#64748b', fontSize: 12 }}>
                    {u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleDateString() : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function WorkspacePage() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div style={S.page}>
      <div style={S.header}>
        <h1 style={S.title}>
          Workspaces
          <span style={{ fontSize: 13, fontWeight: 400, color: '#64748b', marginLeft: 8 }}>V155</span>
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/admin"   style={{ ...S.btn, ...S.btnSecondary, textDecoration: 'none', fontSize: 12 }}>🛡 Admin</a>
          <a href="/"        style={{ ...S.btn, ...S.btnSecondary, textDecoration: 'none', fontSize: 12 }}>← Home</a>
        </div>
      </div>
      <div style={S.body}>
        <WorkspacePlatformStats />
        <CreateWorkspaceForm onCreated={() => setRefreshKey(k => k + 1)} />
        <WorkspaceList key={refreshKey} />
        <ContributionLeaderboard />
      </div>
    </div>
  );
}
