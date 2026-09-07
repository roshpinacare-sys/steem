'use client';

  import { useState, useEffect } from 'react';

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

  const STAGE_COLORS = {
    USE:     { bg: '#e0f2fe', border: '#0284c7', text: '#0c4a6e' },
    VERIFY:  { bg: '#dcfce7', border: '#16a34a', text: '#14532d' },
    OWN:     { bg: '#fef9c3', border: '#ca8a04', text: '#713f12' },
    RECRUIT: { bg: '#ede9fe', border: '#7c3aed', text: '#4c1d95' },
    MENTOR:  { bg: '#fce7f3', border: '#db2777', text: '#831843' },
  };

  // ─── [V150-OWN] Ownership Snapshot — pure helpers (unit-tested) ──────────────
  // Mirrors GET /api/v1/users/:id/ownership response shaping on the client side.
  function fmtCredits(n) {
    return typeof n === 'number' && isFinite(n) ? n.toFixed(2) : '0.00';
  }
  // "3.20%" → 3.2 (number) for progress-bar width; clamps to [0,100].
  function sharePctValue(str) {
    if (typeof str !== 'string') return 0;
    const v = parseFloat(str.replace('%', ''));
    if (!isFinite(v)) return 0;
    return Math.max(0, Math.min(100, v));
  }
  // Cosmetic ownership tier from patches authored.
  function ownershipTier(patchesAuthored) {
    const p = patchesAuthored || 0;
    if (p >= 50) return { id: 'ARCHITECT', label: 'Knowledge Architect', emoji: '🏛️' };
    if (p >= 10) return { id: 'CREATOR',   label: 'Knowledge Creator',   emoji: '💎' };
    if (p >= 1)  return { id: 'AUTHOR',    label: 'Knowledge Author',    emoji: '✍️' };
    return { id: 'NEWCOMER', label: 'Not yet an owner', emoji: '🌱' };
  }

  function OwnershipSnapshot({ userId, apiBase }) {
    const [snap, setSnap] = useState(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr]   = useState(null);

    const load = async () => {
      if (!userId) return;
      setBusy(true); setErr(null);
      try {
        const res  = await fetch(`${apiBase}/api/v1/users/${encodeURIComponent(userId)}/ownership`);
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Failed to load ownership');
        setSnap(data);
      } catch (e) { setErr(e.message); }
      finally { setBusy(false); }
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, [userId]);

    const c = STAGE_COLORS.OWN;
    const tier = ownershipTier(snap?.patchesAuthored);
    const sharePct = sharePctValue(snap?.shareOfKnowledgeBase);

    return (
      <div style={{ background: c.bg, border: `2px solid ${c.border}`, borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.5rem' }}>💎</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', color: c.text }}>Ownership Snapshot</div>
              <div style={{ fontSize: '0.8rem', color: c.text, opacity: 0.8 }}>{tier.emoji} {tier.label}</div>
            </div>
          </div>
          <button onClick={load} disabled={busy || !userId}
            style={{ padding: '0.4rem 0.75rem', background: c.border, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer', opacity: busy ? 0.7 : 1 }}>
            {busy ? '…' : 'Refresh'}
          </button>
        </div>

        {err && <p style={{ color: '#dc2626', fontSize: '0.85rem' }}>{err}</p>}

        {snap && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              {[
                { label: 'Patches Authored',        value: snap.patchesAuthored },
                { label: 'Lifetime Royalties (⊙)',  value: fmtCredits(snap.lifetimeRoyaltiesEarned) },
                { label: 'Royalties · Last 7d (⊙)', value: fmtCredits(snap.royaltiesLast7Days) },
                { label: 'Est. Annual (⊙)',         value: fmtCredits(snap.estimatedAnnualRoyalties) },
              ].map(m => (
                <div key={m.label} style={{ background: 'rgba(255,255,255,0.7)', borderRadius: 8, padding: '0.75rem' }}>
                  <div style={{ fontSize: '0.72rem', color: c.text, opacity: 0.75 }}>{m.label}</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: c.text }}>{m.value}</div>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: c.text, marginBottom: '0.3rem' }}>
                <span>Share of Knowledge Base</span>
                <span style={{ fontWeight: 700 }}>{snap.shareOfKnowledgeBase}</span>
              </div>
              <div style={{ height: 8, background: 'rgba(255,255,255,0.6)', borderRadius: 4 }}>
                <div style={{ height: '100%', width: `${sharePct}%`, background: c.border, borderRadius: 4, transition: 'width 0.3s' }} />
              </div>
            </div>

            <div style={{ fontSize: '0.85rem', color: c.text, fontStyle: 'italic' }}>{snap.message}</div>
          </>
        )}
      </div>
    );
  }

  
// ─── [V153-OWN] Patch History helpers (pure, unit-tested) ────────────────────

/**
 * Extract a list of patch entries from GET /api/v1/users/:id/patches response.
 * @param {*} data  — API response object
 * @returns {Array<{id,taskExcerpt,createdAt,reuseCount,royaltyEarned}>}
 */
export function extractPatchHistory(data) {
  if (!data || typeof data !== 'object') return [];
  const patches = data.patches ?? data.items ?? data.results ?? data.data;
  if (!Array.isArray(patches)) return [];
  return patches.map(p => ({
    id:           p.id || p.patchId || '',
    taskExcerpt:  p.taskExcerpt || p.excerpt || p.content || '(no excerpt)',
    createdAt:    p.createdAt || p.timestamp || null,
    reuseCount:   typeof p.reuseCount === 'number' ? p.reuseCount : 0,
    royaltyEarned: typeof p.royaltyEarned === 'number' ? p.royaltyEarned
                 : (typeof p.royaltyEarned === 'string' ? parseFloat(p.royaltyEarned) || 0 : 0),
  }));
}

/**
 * Extract pagination metadata from the patches API response.
 * @param {*} data
 * @returns {{ total: number, hasMore: boolean, nextOffset: number|null }}
 */
export function extractPatchPagination(data) {
  if (!data || typeof data !== 'object') return { total: 0, hasMore: false, nextOffset: null };
  const total   = typeof data.total === 'number' ? data.total : 0;
  const limit   = typeof data.limit === 'number' ? data.limit : 20;
  const offset  = typeof data.offset === 'number' ? data.offset : 0;
  const hasMore = data.hasMore ?? (offset + limit < total);
  const nextOffset = hasMore ? offset + limit : null;
  return { total, hasMore, nextOffset };
}

/**
 * Format an ISO date string for display in the patch history list.
 * Returns "Unknown date" for null/invalid input.
 * @param {string|null} iso
 * @returns {string}
 */
export function formatPatchDate(iso) {
  if (!iso) return 'Unknown date';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'Unknown date';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Format a royalty amount for display (2 decimal places + ⊙ symbol).
 * Clamps negative values to 0.
 * @param {number|null} royaltyEarned
 * @returns {string}
 */
export function formatPatchRoyalty(royaltyEarned) {
  if (royaltyEarned == null || !isFinite(Number(royaltyEarned))) return '0.00 ⊙';
  return `${Math.max(0, Number(royaltyEarned)).toFixed(2)} ⊙`;
}

// ─── [V153-OWN] PatchHistoryList component ───────────────────────────────────

function PatchHistoryList({ userId, apiBase }) {
  const [open,     setOpen]     = useState(false);
  const [patches,  setPatches]  = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [hasMore,  setHasMore]  = useState(false);
  const [offset,   setOffset]   = useState(0);
  const [total,    setTotal]    = useState(null);
  const [copied,   setCopied]   = useState(null);
  const LIMIT = 20;

  const load = async (currentOffset = 0, append = false) => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/api/v1/users/${encodeURIComponent(userId)}/patches?limit=${LIMIT}&offset=${currentOffset}`
      ).catch(() => null);
      if (!res || !res.ok) throw new Error(`HTTP ${res?.status ?? 'error'}`);
      const data = await res.json().catch(() => null);
      const newPatches = extractPatchHistory(data);
      const pg = extractPatchPagination({ ...data, limit: LIMIT, offset: currentOffset });
      setPatches(prev => append ? [...prev, ...newPatches] : newPatches);
      setHasMore(pg.hasMore);
      setTotal(pg.total);
      setOffset(currentOffset + LIMIT);
    } catch (e) {
      setError(e.message || 'Failed to load patches');
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && patches.length === 0) load(0, false);
  };

  const handleLoadMore = () => load(offset, true);

  const copyId = (id) => {
    try {
      navigator.clipboard.writeText(id).then(() => {
        setCopied(id);
        setTimeout(() => setCopied(null), 1500);
      });
    } catch {}
  };

  return (
    <div style={{ background: '#f0f9ff', border: '1.5px solid #7dd3fc', borderRadius: 12, padding: '1.5rem', marginTop: '1.5rem' }}>
      <button
        onClick={handleToggle}
        aria-expanded={open}
        aria-controls="patch-history-panel"
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: '1rem', color: '#0369a1' }}>
          📜 Patch History {total != null ? `(${total})` : ''}
        </span>
        <span style={{ color: '#0369a1', fontSize: '1.2rem' }} aria-hidden="true">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div id="patch-history-panel" role="region" aria-label="Patch history" style={{ marginTop: '1rem' }}>
          {error && (
            <p style={{ color: '#dc2626', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              ⚠️ {error}
            </p>
          )}

          {!error && patches.length === 0 && !loading && (
            <p style={{ color: '#64748b', fontSize: '0.875rem', textAlign: 'center', padding: '1rem 0' }}>
              No patches yet. Complete tasks and author semantic patches to build your ownership history.
            </p>
          )}

          {patches.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {patches.map((p) => (
                <div
                  key={p.id}
                  style={{
                    background: 'rgba(255,255,255,0.85)',
                    border: '1px solid #bae6fd',
                    borderRadius: 8,
                    padding: '0.75rem 1rem',
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: '0.5rem',
                  }}
                >
                  <div>
                    <p style={{ fontSize: '0.875rem', color: '#0f172a', margin: '0 0 0.4rem', lineHeight: 1.5 }} dir="auto">
                      {p.taskExcerpt}
                    </p>
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.75rem', color: '#64748b' }}>
                      <span>📅 {formatPatchDate(p.createdAt)}</span>
                      <span>🔁 Reused <strong>{p.reuseCount}×</strong></span>
                      <span>💰 {formatPatchRoyalty(p.royaltyEarned)}</span>
                    </div>
                    {p.id && (
                      <div style={{ marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                          {p.id.slice(0, 20)}{p.id.length > 20 ? '…' : ''}
                        </span>
                        <button
                          onClick={() => copyId(p.id)}
                          aria-label={`Copy patch ID ${p.id}`}
                          style={{
                            background: 'none', border: '1px solid #cbd5e1', borderRadius: 4,
                            padding: '1px 6px', fontSize: '0.65rem', cursor: 'pointer', color: '#64748b',
                          }}
                        >
                          {copied === p.id ? '✓ Copied' : 'Copy ID'}
                        </button>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', paddingTop: 2 }}>
                    <span style={{
                      background: p.reuseCount > 10 ? '#dcfce7' : p.reuseCount > 0 ? '#dbeafe' : '#f1f5f9',
                      color:      p.reuseCount > 10 ? '#166534' : p.reuseCount > 0 ? '#1e40af' : '#64748b',
                      borderRadius: 999,
                      padding: '2px 8px',
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}>
                      {p.reuseCount > 10 ? '🔥 Hot' : p.reuseCount > 0 ? '✓ Active' : 'New'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {loading && (
            <div style={{ textAlign: 'center', padding: '1rem 0', color: '#64748b', fontSize: '0.875rem' }}>
              Loading patches…
            </div>
          )}

          {!loading && hasMore && (
            <button
              onClick={handleLoadMore}
              style={{
                marginTop: '0.75rem', width: '100%',
                padding: '0.5rem', background: '#0ea5e9', color: '#fff',
                border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
              }}
            >
              Load more patches
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function MePage() {
    const [userId, setUserId] = useState('demo_user_001');
    const [stats, setStats] = useState({ validationsCompleted: 1, patchesAuthored: 0, referralsConverted: 0, menteeActivated: 0 });
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [evaluated, setEvaluated] = useState(false);

    const fetchProgress = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/api/v1/users/${encodeURIComponent(userId)}/graduation?validationsCompleted=${stats.validationsCompleted}&patchesAuthored=${stats.patchesAuthored}&referralsConverted=${stats.referralsConverted}&menteeActivated=${stats.menteeActivated}`);
        const data = await res.json();
        setReport(data);
        setEvaluated(true);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };

    const currentStageColor = report?.currentStage?.name ? STAGE_COLORS[report.currentStage.name] || STAGE_COLORS.USE : STAGE_COLORS.USE;

    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.25rem' }}>My Profile</h1>
          <p style={{ color: '#64748b', marginBottom: '2rem' }}>Track your ECOS graduation ladder progress</p>

          {/* User Input */}
          <div style={{ background: '#fff', borderRadius: 12, padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151', marginBottom: '1rem' }}>User ID</h2>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <input
                value={userId}
                onChange={e => setUserId(e.target.value)}
                style={{ flex: 1, padding: '0.5rem 0.75rem', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: '0.95rem', outline: 'none' }}
                placeholder="Enter user ID"
              />
            </div>
          </div>

          {/* ─── [V150-OWN] Ownership Snapshot ─────────────────────────────── */}
          <OwnershipSnapshot userId={userId} apiBase={API_BASE} />

          {/* ─── [V153-OWN] Patch History ───────────────────────────────────── */}
          <PatchHistoryList userId={userId} apiBase={API_BASE} />

          {/* Stats Input */}
          <div style={{ background: '#fff', borderRadius: 12, padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151', marginBottom: '1rem' }}>Activity Stats</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {Object.entries(stats).map(([key, val]) => (
                <div key={key}>
                  <label style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '0.25rem', textTransform: 'capitalize' }}>
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </label>
                  <input
                    type="number" min={0}
                    value={val}
                    onChange={e => setStats(s => ({ ...s, [key]: Number(e.target.value) }))}
                    style={{ width: '100%', padding: '0.5rem', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: '0.95rem', boxSizing: 'border-box' }}
                  />
                </div>
              ))}
            </div>
            <button
              onClick={fetchProgress}
              disabled={loading || !userId}
              style={{ marginTop: '1rem', width: '100%', padding: '0.7rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.95rem', cursor: 'pointer', opacity: loading ? 0.7 : 1 }}
            >
              {loading ? 'Loading...' : 'Check Graduation Status'}
            </button>
            {error && <p style={{ color: '#dc2626', marginTop: '0.5rem', fontSize: '0.85rem' }}>{error}</p>}
          </div>

          {/* Graduation Report */}
          {report && (
            <>
              {/* Current Stage */}
              <div style={{ background: currentStageColor.bg, border: `2px solid ${currentStageColor.border}`, borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '1.5rem' }}>
                    {{'USE':'🌱','VERIFY':'✅','OWN':'💎','RECRUIT':'🤝','MENTOR':'🏆'}[report.currentStage?.name] || '🌱'}
                  </span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1.1rem', color: currentStageColor.text }}>{report.currentStage?.name || 'USE'}</div>
                    <div style={{ fontSize: '0.85rem', color: currentStageColor.text, opacity: 0.8 }}>{report.currentStage?.description}</div>
                  </div>
                </div>
                {report.advanced && (
                  <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(255,255,255,0.7)', borderRadius: 8, fontSize: '0.9rem', fontWeight: 600, color: currentStageColor.text }}>
                    Stage advanced! +{report.bonusCredits} bonus credits earned
                  </div>
                )}
              </div>

              {/* All Stages Progress */}
              <div style={{ background: '#fff', borderRadius: 12, padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '1.5rem' }}>
                <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151', marginBottom: '1.25rem' }}>Graduation Ladder</h2>
                {report.allStages?.map((stage, i) => {
                  const color = STAGE_COLORS[stage.name] || STAGE_COLORS.USE;
                  const isActive = stage.name === report.currentStage?.name;
                  return (
                    <div key={stage.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', marginBottom: i < report.allStages.length - 1 ? '1rem' : 0 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: stage.unlocked ? color.border : '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.85rem', flexShrink: 0 }}>
                          {stage.unlocked ? '✓' : stage.id}
                        </div>
                        {i < report.allStages.length - 1 && (
                          <div style={{ width: 2, height: 24, background: stage.unlocked ? color.border : '#e2e8f0', marginTop: 4 }} />
                        )}
                      </div>
                      <div style={{ paddingTop: 4, opacity: stage.unlocked ? 1 : 0.5 }}>
                        <div style={{ fontWeight: isActive ? 700 : 600, color: isActive ? color.text : '#374151', fontSize: '0.95rem' }}>{stage.name}</div>
                        <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{stage.description}</div>
                        {stage.unlockBonus > 0 && <div style={{ fontSize: '0.75rem', color: color.border, fontWeight: 600, marginTop: 2 }}>+{stage.unlockBonus} credits on unlock</div>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Next Requirements */}
              {report.nextRequirements?.length > 0 && (
                <div style={{ background: '#fff', borderRadius: 12, padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', marginBottom: '1.5rem' }}>
                  <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#374151', marginBottom: '1rem' }}>
                    Requirements for {report.nextStage?.name}
                  </h2>
                  {report.nextRequirements.map(req => (
                    <div key={req.metric} style={{ marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem', fontSize: '0.85rem' }}>
                        <span style={{ color: '#374151', textTransform: 'capitalize' }}>{req.metric.replace(/([A-Z])/g, ' $1').trim()}</span>
                        <span style={{ fontWeight: 600, color: req.met ? '#16a34a' : '#374151' }}>{req.current} / {req.required}</span>
                      </div>
                      <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3 }}>
                        <div style={{ height: '100%', background: req.met ? '#16a34a' : '#2563eb', borderRadius: 3, width: `${Math.min(100, (req.current / req.required) * 100)}%`, transition: 'width 0.3s' }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}


              {/* ─── V117: Onboarding Progress ───────────────────────────────── */}
              <div style={{ marginTop: '2rem', background: '#f0f9ff', border: '1.5px solid #7dd3fc', borderRadius: 12, padding: '1.5rem' }}>
                <h2 style={{ margin: '0 0 1rem', fontSize: '1rem', fontWeight: 700, color: '#0369a1' }}>
                  📚 Onboarding Progress
                </h2>
                <OnboardingProgress userId={userId} apiBase={API_BASE} />
              </div>
              {!report.nextStage && (
                <div style={{ background: '#fce7f3', border: '2px solid #db2777', borderRadius: 12, padding: '1.5rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🏆</div>
                  <div style={{ fontWeight: 700, color: '#831843', fontSize: '1.1rem' }}>Maximum Stage Reached</div>
                  <div style={{ color: '#9d174d', fontSize: '0.9rem', marginTop: '0.25rem' }}>You are a MENTOR — the top of the ECOS graduation ladder</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }
  