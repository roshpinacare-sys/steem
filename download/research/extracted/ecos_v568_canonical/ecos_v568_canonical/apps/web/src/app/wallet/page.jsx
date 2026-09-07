// [V150-PAY] Wallet deposit flow with rail selection — DepositPanel posts to /deposit (marker restored V272)
/**
 * ECOS Wallet Page — V152 — Withdrawal UI
 *
 * V152 changes:
 *  [V152-WITH] Withdrawal UI: WithdrawalPanel + PendingWithdrawalsList
 *    - rail selection (canWithdraw filter)
 *    - amount input + validation
 *    - POST /api/v1/rails/:id/withdraw
 *    - sessionStorage persistence for pending withdrawals
 *    - 15s status polling via /rails/:id/status/:ref
 *
 * V151 changes (preserved):
 *  [V151-EARN] Earnings Breakdown: wired to real API data
 *  [V151-PEND] Pending Deposits list: stored in sessionStorage, polled
 */
'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from '../../lib/session';

const EXPRESS_BASE =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_EXPRESS_URL) ||
  'http://localhost:3000';

const CREDIT_SYMBOL       = '⊙';
const PENDING_DEP_KEY     = 'ecos_pending_deposits';
const PENDING_WITH_KEY    = 'ecos_pending_withdrawals';

function fmt(n) { return typeof n === 'number' ? n.toFixed(2) : '—'; }
function fmtCredits(microcents) {
  if (microcents == null) return '—';
  return (Number(microcents) / 10000).toFixed(2);
}

// ─── [V151-EARN] Earnings helpers (pure, unit-tested) ──────────────────────────

export function extractValidationEarnings(data) {
  if (!data || typeof data !== 'object') return 0;
  const v = data.totalEarned ?? data.earnings?.total ?? 0;
  return typeof v === 'number' ? v : 0;
}

export function extractRoyaltyEarnings(data) {
  if (!data || typeof data !== 'object') return 0;
  const v = data.royalties ?? data.totalRoyaltiesEarned ?? 0;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return isFinite(n) ? Math.max(0, n) : 0;
}

export function extractReferralBonus(data) {
  if (!data || typeof data !== 'object') return 0;
  const v = data.referralBonus ?? data.referral?.earned ?? 0;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return isFinite(n) ? Math.max(0, n) : 0;
}

// ─── [V151-PEND] Pending deposit helpers (pure, unit-tested) ───────────────────

export function loadPendingDeposits() {
  try {
    const raw = sessionStorage.getItem(PENDING_DEP_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function savePendingDeposit(entry) {
  try {
    const list = loadPendingDeposits();
    const exists = list.some(d => d.reference === entry.reference);
    if (!exists) {
      list.unshift({ ...entry, status: 'pending' });
      sessionStorage.setItem(PENDING_DEP_KEY, JSON.stringify(list.slice(0, 20)));
    }
  } catch {}
}

export function updateDepositStatus(reference, status) {
  try {
    const list = loadPendingDeposits();
    const updated = list.map(d => d.reference === reference ? { ...d, status } : d);
    sessionStorage.setItem(PENDING_DEP_KEY, JSON.stringify(updated));
  } catch {}
}

export function depositStatusLabel(status) {
  switch (status) {
    case 'confirmed': return { text: 'Confirmed',  bg: '#064e3b', color: '#6ee7b7' };
    case 'rejected':  return { text: 'Rejected',   bg: '#450a0a', color: '#fca5a5' };
    case 'pending':
    default:          return { text: 'Pending',    bg: '#1c1917', color: '#fcd34d' };
  }
}

// ─── [V152-WITH] Withdrawal helpers (pure, unit-tested) ────────────────────────

/**
 * Returns true if a payment rail supports withdrawals.
 * Shape: { isAvailable: bool, capabilities: { canWithdraw: bool } }
 */
export function isRailWithdrawable(rail) {
  return !!(rail && rail.isAvailable && rail.capabilities && rail.capabilities.canWithdraw);
}

/**
 * Build a deterministic withdrawal reference code.
 * Format: ECOS-W-{RAIL}-{6-char hash}
 */
export function withdrawalReference(accountId, railId, seed) {
  const base = `w:${accountId || 'acct'}:${railId || 'rail'}:${seed != null ? seed : Date.now()}`;
  let h = 0;
  for (let i = 0; i < base.length; i++) { h = (h * 31 + base.charCodeAt(i)) >>> 0; }
  const code = h.toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
  return `ECOS-W-${String(railId || 'RAIL').toUpperCase()}-${code}`;
}

/**
 * Human-readable withdrawal instructions per rail.
 */
export function withdrawalInstructions(railId, reference, amountUsd) {
  switch (railId) {
    case 'bank':
      return `A bank transfer of $${amountUsd} will be sent to your registered account. Reference ${reference}. Processing takes 1–3 business days.`;
    case 'manual':
      return `A manual withdrawal of $${amountUsd} has been recorded under reference ${reference}. An operator will process it shortly.`;
    case 'stripe':
      return `$${amountUsd} will be refunded to your card on file. Reference ${reference}. May take 5–10 business days.`;
    default:
      return `Withdrawal of $${amountUsd} initiated. Reference ${reference}.`;
  }
}

/**
 * Load pending withdrawals from sessionStorage.
 */
export function loadPendingWithdrawals() {
  try {
    const raw = sessionStorage.getItem(PENDING_WITH_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

/**
 * Append a withdrawal entry (idempotent by reference, max 20 entries).
 */
export function savePendingWithdrawal(entry) {
  try {
    const list = loadPendingWithdrawals();
    const exists = list.some(w => w.reference === entry.reference);
    if (!exists) {
      list.unshift({ ...entry, status: 'pending' });
      sessionStorage.setItem(PENDING_WITH_KEY, JSON.stringify(list.slice(0, 20)));
    }
  } catch {}
}

/**
 * Update the status of a single withdrawal by reference.
 */
export function updateWithdrawalStatus(reference, status) {
  try {
    const list = loadPendingWithdrawals();
    const updated = list.map(w => w.reference === reference ? { ...w, status } : w);
    sessionStorage.setItem(PENDING_WITH_KEY, JSON.stringify(updated));
  } catch {}
}

/**
 * Return badge colours for a withdrawal status.
 * Reuses the same colour palette as depositStatusLabel.
 */
ex

// ═════════════════════════════════════════════════════════════════════════════
// V154 — Persistent Withdrawal History (localStorage + API)
// ═════════════════════════════════════════════════════════════════════════════

const LS_WITHDRAWAL_HISTORY_KEY = 'ecos_withdrawal_history_v154';

/**
 * Load durable withdrawal history from localStorage.
 * Falls back to sessionStorage (V152) entries for continuity.
 */
export function loadDurableWithdrawalHistory() {
  try {
    const raw = localStorage.getItem(LS_WITHDRAWAL_HISTORY_KEY);
    const ls  = raw ? JSON.parse(raw) : [];
    // Merge any sessionStorage entries not yet in LS
    let ss = [];
    try {
      const ssRaw = sessionStorage.getItem('ecos_pending_withdrawals');
      ss = ssRaw ? JSON.parse(ssRaw) : [];
    } catch { /* ignore */ }
    const merged = [...ls];
    for (const ssEntry of ss) {
      if (!merged.some(e => e.reference === ssEntry.reference)) {
        merged.push(ssEntry);
      }
    }
    return merged.sort((a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0)).slice(0, 50);
  } catch { return []; }
}

/**
 * Append a withdrawal to localStorage history (durable across tab closes).
 */
export function saveDurableWithdrawal(entry) {
  try {
    const list = loadDurableWithdrawalHistory();
    if (!list.some(e => e.reference === entry.reference)) {
      list.unshift({ ...entry, savedAt: new Date().toISOString() });
      localStorage.setItem(LS_WITHDRAWAL_HISTORY_KEY, JSON.stringify(list.slice(0, 50)));
    }
  } catch { /* storage full? ignore */ }
}

/**
 * Update status of a durable withdrawal entry.
 */
export function updateDurableWithdrawalStatus(reference, status) {
  try {
    const list = loadDurableWithdrawalHistory();
    const updated = list.map(e =>
      e.reference === reference
        ? { ...e, status, resolvedAt: status !== 'pending' ? new Date().toISOString() : e.resolvedAt }
        : e
    );
    localStorage.setItem(LS_WITHDRAWAL_HISTORY_KEY, JSON.stringify(updated));
  } catch { /* non-fatal */ }
}

/**
 * Format a withdrawal amount string (e.g. "12.50").
 */
export function formatWithdrawalAmount(amount) {
  const n = parseFloat(amount);
  if (!isFinite(n) || n < 0) return '0.00';
  return n.toFixed(2);
}

/**
 * Build a timeline entry label from a withdrawal record.
 */
export function withdrawalTimelineLabel(w) {
  const rail  = (w.railId || w.rail || 'unknown').toUpperCase();
  const amt   = formatWithdrawalAmount(w.amountUsd || w.amount);
  const date  = w.requestedAt
    ? new Date(w.requestedAt).toLocaleDateString()
    : (w.savedAt ? new Date(w.savedAt).toLocaleDateString() : '—');
  return `${rail} • $${amt} • ${date}`;
}

/**
 * Classify a withdrawal status for display.
 */
export function withdrawalTimelineStatus(status) {
  switch ((status || '').toLowerCase()) {
    case 'confirmed': return { dot: '#22c55e', label: 'Confirmed' };
    case 'rejected':  return { dot: '#ef4444', label: 'Rejected'  };
    case 'pending':
    default:          return { dot: '#f59e0b', label: 'Pending'   };
  }
}

/**
 * Export withdrawal history as a CSV string (for download).
 */
export function exportWithdrawalsAsCsv(history) {
  const header = 'Reference,Rail,Amount (USD),Status,Requested At,Resolved At';
  const rows = history.map(w =>
    [
      w.reference    || '',
      w.railId       || w.rail || '',
      formatWithdrawalAmount(w.amountUsd || w.amount),
      w.status       || 'pending',
      w.requestedAt  || w.savedAt || '',
      w.resolvedAt   || '',
    ].join(',')
  );
  return [header, ...rows].join('\n');
}

// ── WithdrawalHistoryPanel Component ─────────────────────────────────────────

function WithdrawalHistoryPanel({ accountId }) {
  const [history, setHistory]         = useState([]);
  const [apiHistory, setApiHistory]   = useState([]);
  const [showPanel, setShowPanel]     = useState(false);
  const [loadingApi, setLoadingApi]   = useState(false);

  // Load from localStorage on mount / when panel opens
  useEffect(() => {
    if (showPanel) setHistory(loadDurableWithdrawalHistory());
  }, [showPanel]);

  // Fetch from API when panel opens
  useEffect(() => {
    if (!showPanel || !accountId) return;
    setLoadingApi(true);
    fetch(`${EXPRESS_BASE}/api/v1/withdrawals/history?accountId=${encodeURIComponent(accountId)}&limit=30`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.history) setApiHistory(data.history);
      })
      .catch(() => { /* non-fatal */ })
      .finally(() => setLoadingApi(false));
  }, [showPanel, accountId]);

  // Merge local + API
  const merged = React.useMemo(() => {
    const all = [...(apiHistory.length ? apiHistory : history)];
    for (const h of history) {
      if (!all.some(e => e.reference === h.reference)) all.push(h);
    }
    return all.sort((a,b) => new Date(b.requestedAt || b.savedAt || 0) - new Date(a.requestedAt || a.savedAt || 0)).slice(0, 50);
  }, [history, apiHistory]);

  const handleExport = () => {
    const csv  = exportWithdrawalsAsCsv(merged);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'withdrawals.csv' });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const btnStyle = {
    padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
    fontSize: 12, fontWeight: 600, background: '#334155', color: '#cbd5e1',
  };

  return (
    <div style={{ marginTop: 24, background: '#1e293b', borderRadius: 10, border: '1px solid #334155', overflow: 'hidden' }}>
      <button
        onClick={() => setShowPanel(v => !v)}
        aria-expanded={showPanel}
        style={{ width: '100%', padding: '14px 18px', background: 'transparent', border: 'none', cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#e2e8f0' }}
      >
        <span style={{ fontWeight: 700, fontSize: 13, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>
          📋 Withdrawal History {merged.length > 0 && !showPanel ? `(${merged.length})` : ''}
        </span>
        <span style={{ color: '#64748b', fontSize: 12 }}>{showPanel ? '▲ Collapse' : '▼ Expand'}</span>
      </button>

      {showPanel && (
        <div style={{ padding: '0 18px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>
              {loadingApi ? 'Syncing with server…' : `${merged.length} record${merged.length !== 1 ? 's' : ''}`}
            </span>
            {merged.length > 0 && (
              <button onClick={handleExport} style={btnStyle}>⬇ Export CSV</button>
            )}
          </div>

          {merged.length === 0 ? (
            <p style={{ color: '#475569', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
              No withdrawal history yet.
            </p>
          ) : (
            <div style={{ position: 'relative', paddingLeft: 20 }}>
              {/* Timeline line */}
              <div style={{
                position: 'absolute', left: 7, top: 8, bottom: 8, width: 2, background: '#334155'
              }} />
              {merged.map((w, i) => {
                const st = withdrawalTimelineStatus(w.status);
                return (
                  <div key={i} style={{ position: 'relative', marginBottom: 16, paddingLeft: 16 }}>
                    {/* Dot */}
                    <div style={{
                      position: 'absolute', left: -7, top: 4, width: 12, height: 12,
                      borderRadius: '50%', background: st.dot, border: '2px solid #0f172a',
                    }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#a5b4fc' }}>
                        {w.reference || '—'}
                      </span>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 10,
                        background: st.dot + '22', color: st.dot,
                      }}>{st.label}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                      {withdrawalTimelineLabel(w)}
                    </div>
                    {w.resolvedAt && (
                      <div style={{ fontSize: 11, color: '#475569', marginTop: 1 }}>
                        Resolved: {new Date(w.resolvedAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
port function withdrawalStatusLabel(status) {
  switch (status) {
    case 'confirmed': return { text: 'Confirmed',  bg: '#064e3b', color: '#6ee7b7' };
    case 'rejected':  return { text: 'Rejected',   bg: '#450a0a', color: '#fca5a5' };
    case 'pending':
    default:          return { text: 'Pending',    bg: '#1c1917', color: '#fcd34d' };
  }
}

// ─── Reused helpers ────────────────────────────────────────────────────────────

function isRailSelectable(rail) {
  return !!(rail && rail.isAvailable && rail.capabilities && rail.capabilities.canDeposit);
}
function validAmount(str) {
  const n = parseFloat(str);
  if (!isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}
function depositReference(accountId, railId, seed) {
  const base = `${accountId || 'acct'}:${railId || 'rail'}:${seed != null ? seed : Date.now()}`;
  let h = 0;
  for (let i = 0; i < base.length; i++) { h = (h * 31 + base.charCodeAt(i)) >>> 0; }
  const code = h.toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
  return `ECOS-${String(railId || 'RAIL').toUpperCase()}-${code}`;
}
function railInstructions(railId, reference, amountUsd) {
  switch (railId) {
    case 'bank':   return `Transfer $${amountUsd} to the ECOS settlement account and include reference ${reference} in the memo. Credits are granted on confirmation.`;
    case 'manual': return `A manual credit grant of $${amountUsd} has been recorded under reference ${reference}.`;
    case 'stripe': return `Complete the $${amountUsd} card payment in the Stripe checkout. Reference ${reference}.`;
    default:       return `Deposit of $${amountUsd} initiated. Reference ${reference}.`;
  }
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function RailCard({ rail }) {
  const caps = rail.capabilities || {};
  return (
    <div style={railCardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: 16, color: '#e5e7eb' }}>{rail.displayName}</span>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
          padding: '3px 8px', borderRadius: 100,
          background: rail.isAvailable ? '#064e3b' : '#1f2937',
          color:      rail.isAvailable ? '#6ee7b7' : '#6b7280',
        }}>
          {rail.isAvailable ? 'AVAILABLE' : 'UNAVAILABLE'}
        </span>
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {caps.canDeposit  && <Tag color="#1d4ed8">Deposit</Tag>}
        {caps.canWithdraw && <Tag color="#7c3aed">Withdraw</Tag>}
        {caps.instant     && <Tag color="#065f46">Instant</Tag>}
        {caps.regions && caps.regions.length === 0 && <Tag color="#374151">Global</Tag>}
        {caps.regions && caps.regions.map(r => <Tag key={r} color="#374151">{r}</Tag>)}
      </div>
      <p style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
        {rail.id === 'manual' && 'Direct credit grant. Works everywhere, no bank or card required.'}
        {rail.id === 'bank'   && 'Bank transfer. Works with any local bank (including Israeli banks).'}
        {rail.id === 'stripe' && 'Card payment via Stripe. Available in supported regions.'}
        {rail.id === 'crypto' && 'Crypto payment. Coming soon — reserved for future use.'}
      </p>
    </div>
  );
}

function Tag({ color, children }) {
  return (
    <span style={{
      background: color + '33', color: '#e5e7eb',
      border: `1px solid ${color}55`,
      borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 600,
    }}>{children}</span>
  );
}

// ─── [V151-EARN] Earnings Breakdown (real data) ────────────────────────────────

function EarningsBreakdown({ accountId, apiBase }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const fetch3 = useCallback(async () => {
    if (!accountId) return;
    setLoading(true); setError(null);
    try {
      const [earnRes, ownRes, acctRes] = await Promise.allSettled([
        fetch(`${apiBase}/api/v1/validator/${encodeURIComponent(accountId)}/earnings`).catch(() => null),
        fetch(`${apiBase}/api/v1/users/${encodeURIComponent(accountId)}/ownership`).catch(() => null),
        fetch(`${apiBase}/api/v1/account?id=${encodeURIComponent(accountId)}`).catch(() => null),
      ]);
      const earnData  = (earnRes.status  === 'fulfilled' && earnRes.value?.ok)  ? await earnRes.value.json().catch(() => null)  : null;
      const ownData   = (ownRes.status   === 'fulfilled' && ownRes.value?.ok)   ? await ownRes.value.json().catch(() => null)   : null;
      const acctData  = (acctRes.status  === 'fulfilled' && acctRes.value?.ok)  ? await acctRes.value.json().catch(() => null)  : null;
      setData({
        validation: extractValidationEarnings(earnData),
        royalty:    extractRoyaltyEarnings(ownData),
        referral:   extractReferralBonus(acctData),
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [accountId, apiBase]);

  useEffect(() => { fetch3(); }, [fetch3]);

  const items = [
    { label: 'Validation Earnings', value: data?.validation ?? null, color: '#22c55e',  tip: 'Credits earned by reviewing HITL tasks' },
    { label: 'Royalty Earnings',    value: data?.royalty    ?? null, color: '#c4b5fd',  tip: 'Ongoing royalties from your semantic patches' },
    { label: 'Referral Bonuses',    value: data?.referral   ?? null, color: '#f59e0b',  tip: 'Credits earned by referring new validators' },
  ];

  return (
    <div style={sectionStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={sectionTitleStyle}>Earnings Breakdown</h2>
        {!loading && (
          <button onClick={fetch3} style={refreshBtnStyle} title="Refresh earnings">
            ↺ Refresh
          </button>
        )}
      </div>
      {error && (
        <p style={{ color: '#f87171', fontSize: 13, marginBottom: 12 }}>
          Could not load earnings — showing cached or zero values.
        </p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
        {items.map(item => (
          <div key={item.label} style={{ background: '#1a1a2e', border: '1px solid #2d2d44', borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: item.color, lineHeight: 1.2 }}>
              {loading ? (
                <span style={{ color: '#374151', fontSize: 18 }}>…</span>
              ) : (
                <>{fmt(item.value ?? 0)} <span style={{ fontSize: 15 }}>{CREDIT_SYMBOL}</span></>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#4b5563', marginTop: 6 }}>{item.tip}</div>
          </div>
        ))}
      </div>
      {!loading && data && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#4b5563', textAlign: 'right' }}>
          Total earned: <strong style={{ color: '#9ca3af' }}>
            {fmt((data.validation ?? 0) + (data.royalty ?? 0) + (data.referral ?? 0))} {CREDIT_SYMBOL}
          </strong>
        </div>
      )}
    </div>
  );
}

// ─── [V151-PEND] Pending Deposits List ────────────────────────────────────────

function PendingDepositsList({ apiBase, refreshSignal }) {
  const [deposits, setDeposits] = useState([]);
  const pollRef = useRef(null);

  const reload = useCallback(() => { setDeposits(loadPendingDeposits()); }, []);

  const pollStatuses = useCallback(async () => {
    const list = loadPendingDeposits();
    const pending = list.filter(d => d.status === 'pending');
    for (const d of pending) {
      try {
        const res = await fetch(`${apiBase}/api/v1/rails/${encodeURIComponent(d.railId)}/status/${encodeURIComponent(d.reference)}`).catch(() => null);
        if (res && res.ok) {
          const body = await res.json().catch(() => null);
          const s = body?.status ?? body?.depositStatus ?? 'pending';
          if (s !== 'pending') updateDepositStatus(d.reference, s);
        }
      } catch {}
    }
    reload();
  }, [apiBase, reload]);

  useEffect(() => { reload(); }, [reload, refreshSignal]);
  useEffect(() => {
    pollRef.current = setInterval(pollStatuses, 15000);
    return () => clearInterval(pollRef.current);
  }, [pollStatuses]);

  if (deposits.length === 0) return null;

  return (
    <div style={sectionStyle}>
      <h2 style={sectionTitleStyle}>Pending Deposits</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {deposits.map(d => {
          const badge = depositStatusLabel(d.status);
          return (
            <div key={d.reference} style={pendingRowStyle}>
              <div>
                <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#c4b5fd', marginRight: 10 }}>
                  {d.reference}
                </span>
                <span style={{ fontSize: 12, color: '#6b7280' }}>${d.amountUsd} via {d.railId}</span>
                {d.initiatedAt && (
                  <span style={{ fontSize: 11, color: '#374151', marginLeft: 8 }}>
                    · {new Date(d.initiatedAt).toLocaleString()}
                  </span>
                )}
              </div>
              <StatusBadge badge={badge} />
            </div>
          );
        })}
      </div>
      <p style={pendingFootnoteStyle}>Status auto-refreshes every 15 s. Deposits persist for this browser session.</p>
    </div>
  );
}

// ─── [V152-WITH] Pending Withdrawals List ─────────────────────────────────────

function PendingWithdrawalsList({ apiBase, refreshSignal }) {
  const [withdrawals, setWithdrawals] = useState([]);
  const pollRef = useRef(null);

  const reload = useCallback(() => { setWithdrawals(loadPendingWithdrawals()); }, []);

  const pollStatuses = useCallback(async () => {
    const list = loadPendingWithdrawals();
    const pending = list.filter(w => w.status === 'pending');
    for (const w of pending) {
      try {
        const res = await fetch(`${apiBase}/api/v1/rails/${encodeURIComponent(w.railId)}/status/${encodeURIComponent(w.reference)}`).catch(() => null);
        if (res && res.ok) {
          const body = await res.json().catch(() => null);
          const s = body?.status ?? body?.withdrawalStatus ?? 'pending';
          if (s !== 'pending') updateWithdrawalStatus(w.reference, s);
        }
      } catch {}
    }
    reload();
  }, [apiBase, reload]);

  useEffect(() => { reload(); }, [reload, refreshSignal]);
  useEffect(() => {
    pollRef.current = setInterval(pollStatuses, 15000);
    return () => clearInterval(pollRef.current);
  }, [pollStatuses]);

  if (withdrawals.length === 0) return null;

  return (
    <div style={sectionStyle}>
      <h2 style={sectionTitleStyle}>Pending Withdrawals</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {withdrawals.map(w => {
          const badge = withdrawalStatusLabel(w.status);
          return (
            <div key={w.reference} style={pendingRowStyle}>
              <div>
                <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#f9a8d4', marginRight: 10 }}>
                  {w.reference}
                </span>
                <span style={{ fontSize: 12, color: '#6b7280' }}>${w.amountUsd} via {w.railId}</span>
                {w.initiatedAt && (
                  <span style={{ fontSize: 11, color: '#374151', marginLeft: 8 }}>
                    · {new Date(w.initiatedAt).toLocaleString()}
                  </span>
                )}
              </div>
              <StatusBadge badge={badge} />
            </div>
          );
        })}
      </div>
      <p style={pendingFootnoteStyle}>Status auto-refreshes every 15 s. Withdrawals persist for this browser session.</p>
    </div>
  );
}

// ─── Shared badge component ────────────────────────────────────────────────────

function StatusBadge({ badge }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
      padding: '3px 10px', borderRadius: 100,
      background: badge.bg, color: badge.color,
    }}>
      {badge.text}
    </span>
  );
}

// ─── Deposit Panel (V150 + V151 sessionStorage persistence) ───────────────────

function DepositPanel({ accountId, rails, apiBase, onDeposited }) {
  const selectable = (rails || []).filter(isRailSelectable);
  const [railId, setRailId] = React.useState(selectable[0]?.id || '');
  const [amount, setAmount] = React.useState('10');
  const [busy,   setBusy]   = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [err,    setErr]    = React.useState(null);

  React.useEffect(() => {
    if (!railId && selectable[0]) setRailId(selectable[0].id);
    // eslint-disable-next-line
  }, [rails]);

  const submit = async () => {
    const amt = validAmount(amount);
    if (!railId) { setErr('Select a payment rail'); return; }
    if (amt == null) { setErr('Enter a valid amount greater than 0'); return; }
    setBusy(true); setErr(null); setResult(null);
    const reference = depositReference(accountId, railId, Date.now());
    try {
      const res = await fetch(`${apiBase}/api/v1/rails/${encodeURIComponent(railId)}/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, amountUsd: amt, reference }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Deposit failed');
      savePendingDeposit({ reference, railId, amountUsd: amt, initiatedAt: Date.now() });
      setResult({ reference, amountUsd: amt, instructions: railInstructions(railId, reference, amt), data });
      if (onDeposited) onDeposited();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  if (selectable.length === 0) {
    return <p style={{ color: '#6b7280', fontSize: 13, marginTop: 12 }}>No deposit-capable rails are currently available.</p>;
  }

  return (
    <div style={panelStyle}>
      <h3 style={panelTitleStyle}>Make a Deposit</h3>
      <div style={panelRowStyle}>
        <div style={{ flex: '1 1 160px' }}>
          <label style={labelStyle}>Payment rail</label>
          <select value={railId} onChange={e => setRailId(e.target.value)} style={selectStyle}>
            {selectable.map(r => <option key={r.id} value={r.id}>{r.displayName}</option>)}
          </select>
        </div>
        <div style={{ flex: '1 1 120px' }}>
          <label style={labelStyle}>Amount (USD)</label>
          <input value={amount} onChange={e => setAmount(e.target.value)} type="number" min={0} step="0.01"
            style={inputStyle} />
        </div>
        <button onClick={submit} disabled={busy} style={{ ...actionBtnStyle, background: '#7c3aed' }}>
          {busy ? 'Processing…' : 'Deposit'}
        </button>
      </div>
      {err && <p style={errStyle}>{err}</p>}
      {result && (
        <div style={{ marginTop: 14, padding: '12px 16px', background: '#064e3b', border: '1px solid #10b98155', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#6ee7b7', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 4 }}>Deposit initiated</div>
          <div style={{ fontSize: 13, color: '#d1fae5' }}>Reference: <strong style={{ fontFamily: 'monospace' }}>{result.reference}</strong></div>
          <div style={{ fontSize: 13, color: '#a7f3d0', marginTop: 6 }}>{result.instructions}</div>
        </div>
      )}
    </div>
  );
}

// ─── [V152-WITH] Withdrawal Panel ─────────────────────────────────────────────

function WithdrawalPanel({ accountId, rails, apiBase, onWithdrawn, balanceCredits }) {
  const withdrawable = (rails || []).filter(isRailWithdrawable);
  const [railId, setRailId] = React.useState(withdrawable[0]?.id || '');
  const [amount, setAmount] = React.useState('10');
  const [busy,   setBusy]   = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [err,    setErr]    = React.useState(null);

  React.useEffect(() => {
    if (!railId && withdrawable[0]) setRailId(withdrawable[0].id);
    // eslint-disable-next-line
  }, [rails]);

  // [V153-WL] Eligibility check on current amount
  const amtNum   = validAmount(amount);
  const eligibility = checkWithdrawalEligibility(balanceCredits, amtNum);

  const submit = async () => {
    const amt = validAmount(amount);
    if (!railId) { setErr('Select a payment rail'); return; }
    if (amt == null) { setErr('Enter a valid amount greater than 0'); return; }
    // [V153-WL] Enforce balance limit before sending request
    const elig = checkWithdrawalEligibility(balanceCredits, amt);
    if (!elig.eligible) { setErr(elig.reason); return; }
    setBusy(true); setErr(null); setResult(null);
    const reference = withdrawalReference(accountId, railId, Date.now());
    try {
      const res = await fetch(`${apiBase}/api/v1/rails/${encodeURIComponent(railId)}/withdraw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId, amountUsd: amt, reference }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Withdrawal failed');
      savePendingWithdrawal({ reference, railId, amountUsd: amt, initiatedAt: Date.now() });
      setResult({
        reference,
        amountUsd: amt,
        instructions: withdrawalInstructions(railId, reference, amt),
        data,
      });
      if (onWithdrawn) onWithdrawn();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  if (withdrawable.length === 0) {
    return (
      <p style={{ color: '#6b7280', fontSize: 13, marginTop: 12 }}>
        No withdrawal-capable rails are currently available.
      </p>
    );
  }

  return (
    <div style={{ ...panelStyle, borderColor: '#7c3aed44' }}>
      <h3 style={panelTitleStyle}>Withdraw Credits</h3>
      <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 14px' }}>
        Convert your ECOS credits to fiat currency via your preferred payment rail.
      </p>
      <div style={panelRowStyle}>
        <div style={{ flex: '1 1 160px' }}>
          <label style={labelStyle}>Withdrawal rail</label>
          <select value={railId} onChange={e => setRailId(e.target.value)} style={selectStyle}>
            {withdrawable.map(r => <option key={r.id} value={r.id}>{r.displayName}</option>)}
          </select>
        </div>
        <div style={{ flex: '1 1 120px' }}>
          <label style={labelStyle}>Amount (USD)</label>
          <input value={amount} onChange={e => setAmount(e.target.value)} type="number" min={0} step="0.01"
            style={inputStyle} />
        </div>
        <button onClick={submit} disabled={busy || !eligibility.eligible} style={{ ...actionBtnStyle, background: busy || !eligibility.eligible ? '#374151' : '#6d28d9', cursor: busy || !eligibility.eligible ? 'not-allowed' : 'pointer' }}>
          {busy ? 'Processing…' : 'Withdraw'}
        </button>
      </div>
      {/* [V153-WL] Balance display + inline eligibility warning */}
      {balanceCredits != null && (
        <p style={{ fontSize: 12, color: eligibility.eligible ? '#6b7280' : '#f87171', marginTop: 8 }}>
          Available: <strong style={{ color: eligibility.eligible ? '#9ca3af' : '#f87171' }}>{formatAvailableBalance(balanceCredits)}</strong>
          {!eligibility.eligible && amtNum != null && (
            <span style={{ marginLeft: 8 }}>— {eligibility.reason}</span>
          )}
        </p>
      )}
      {err && <p style={errStyle}>{err}</p>}
      {result && (
        <div style={{ marginTop: 14, padding: '12px 16px', background: '#1e1b4b', border: '1px solid #6d28d955', borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: '#a5b4fc', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 4 }}>Withdrawal initiated</div>
          <div style={{ fontSize: 13, color: '#e0e7ff' }}>Reference: <strong style={{ fontFamily: 'monospace' }}>{result.reference}</strong></div>
          <div style={{ fontSize: 13, color: '#c7d2fe', marginTop: 6 }}>{result.instructions}</div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function WalletPage() {
  const [credits,          setCredits]          = useState(null);
  const [freeTier,         setFreeTier]          = useState(null);
  const [rails,            setRails]             = useState([]);
  const [loading,          setLoading]           = useState(true);
  const [depositSignal,    setDepositSignal]    = useState(0);
  const [withdrawalSignal, setWithdrawalSignal] = useState(0);
  const { session } = useSession();
  const [accountId, setAccountId] = useState('demo-account');

  useEffect(() => {
    if (session?.validatorId) setAccountId(session.validatorId);
  }, [session?.validatorId]);

  const fetchWallet = useCallback(async () => {
    try {
      const [credRes, railRes] = await Promise.all([
        fetch(`${EXPRESS_BASE}/api/v1/credits/${accountId}`).catch(() => null),
        fetch(`${EXPRESS_BASE}/api/v1/rails`).catch(() => null),
      ]);
      if (credRes && credRes.ok) {
        const data = await credRes.json();
        setCredits(data.balanceCredits ?? data.credits ?? 0);
        setFreeTier(data.freeTier || null);
      }
      if (railRes && railRes.ok) {
        const data = await railRes.json();
        setRails(data.rails || data || []);
      }
    } catch (_) {}
    finally { setLoading(false); }
  }, [accountId]);

  useEffect(() => { fetchWallet(); }, [fetchWallet]);

  const handleDeposited  = useCallback(() => { fetchWallet(); setDepositSignal(s => s + 1); },    [fetchWallet]);
  const handleWithdrawn  = useCallback(() => { fetchWallet(); setWithdrawalSignal(s => s + 1); }, [fetchWallet]);

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: '#e5e7eb', marginBottom: 4 }}>Wallet</h1>
        <p style={{ color: '#6b7280', marginBottom: 32 }}>Your ECOS economic home — credits, rails, earnings, and withdrawals</p>

        {loading ? (
          <div style={{ color: '#6b7280', textAlign: 'center', padding: '60px 0' }}>Loading…</div>
        ) : (
          <>
            {/* ── Credit balance ── */}
            <div style={balanceCardStyle}>
              <div style={{ fontSize: 13, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                Credit Balance
              </div>
              <div style={{ fontSize: 64, fontWeight: 900, color: '#c4b5fd', lineHeight: 1, letterSpacing: '-0.02em' }}>
                {fmt(credits ?? 0)}
              </div>
              <div style={{ fontSize: 22, color: '#7c3aed', fontWeight: 700, marginTop: 4 }}>
                {CREDIT_SYMBOL} ECOS Credits
              </div>
              {freeTier && (
                <div style={{ marginTop: 16, padding: '10px 16px', background: '#1f2937', borderRadius: 8, display: 'inline-block' }}>
                  <span style={{ color: '#9ca3af', fontSize: 13 }}>
                    Free tier: <strong style={{ color: '#c4b5fd' }}>{fmt(freeTier.remaining)} {CREDIT_SYMBOL}</strong> remaining
                    {freeTier.refreshesAt && ` · refreshes ${new Date(freeTier.refreshesAt).toLocaleDateString()}`}
                  </span>
                </div>
              )}
            </div>

            {/* ── [V151-EARN] Real Earnings Breakdown ── */}
            <EarningsBreakdown accountId={accountId} apiBase={EXPRESS_BASE} />

            {/* ── [V151-PEND] Pending Deposits ── */}
            <PendingDepositsList apiBase={EXPRESS_BASE} refreshSignal={depositSignal} />

            {/* ── [V152-WITH] Pending Withdrawals ── */}
            <WithdrawalHistoryPanel accountId={session?.validatorId || session?.userId || ''} />
        <PendingWithdrawalsList apiBase={EXPRESS_BASE} refreshSignal={withdrawalSignal} />

            {/* ── Add Credits / Rails ── */}
            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}>Add Credits</h2>
              <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 16 }}>
                Choose a payment method. Manual and bank transfer work worldwide — no Stripe required.
              </p>
              {rails.length === 0 ? (
                <p style={{ color: '#6b7280', fontSize: 14 }}>No payment rails available.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                  {rails.map(r => <RailCard key={r.id} rail={r} />)}
                </div>
              )}
              <DepositPanel accountId={accountId} rails={rails} apiBase={EXPRESS_BASE} onDeposited={handleDeposited} />
            </div>

            {/* ── [V152-WITH] Withdraw Credits ── */}
            <div style={sectionStyle}>
              <h2 style={sectionTitleStyle}>Withdraw Credits</h2>
              <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 16 }}>
                Convert your credits back to fiat. Withdrawals are processed via the same rails you use to deposit.
              </p>
              <WithdrawalPanel accountId={accountId} rails={rails} apiBase={EXPRESS_BASE} onWithdrawn={handleWithdrawn} balanceCredits={credits} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const pageStyle       = { minHeight: '100%', background: '#0f0f1a', padding: '40px 24px', overflowY: 'auto' };
const containerStyle  = { maxWidth: 900, margin: '0 auto' };
const balanceCardStyle = {
  background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
  border: '1px solid #7c3aed44', borderRadius: 20, padding: '40px 40px 32px', marginBottom: 32,
  boxShadow: '0 0 60px #7c3aed22',
};
const sectionStyle       = { marginBottom: 32 };
const sectionTitleStyle  = { fontSize: 18, fontWeight: 700, color: '#e5e7eb', margin: '0 0 0 0' };
const railCardStyle      = { background: '#1a1a2e', border: '1px solid #2d2d44', borderRadius: 12, padding: 20 };
const refreshBtnStyle    = { background: 'none', border: '1px solid #374151', color: '#6b7280', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' };
const panelStyle         = { marginTop: 20, background: '#15152b', border: '1px solid #2d2d44', borderRadius: 12, padding: 20 };
const panelTitleStyle    = { fontSize: 15, fontWeight: 700, color: '#e5e7eb', margin: '0 0 12px' };
const panelRowStyle      = { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' };
const labelStyle         = { display: 'block', fontSize: 12, color: '#9ca3af', marginBottom: 4 };
const selectStyle        = { width: '100%', padding: '8px 10px', borderRadius: 8, background: '#0f0f1a', color: '#e5e7eb', border: '1px solid #2d2d44', fontSize: 14 };
const inputStyle         = { width: '100%', padding: '8px 10px', borderRadius: 8, background: '#0f0f1a', color: '#e5e7eb', border: '1px solid #2d2d44', fontSize: 14, boxSizing: 'border-box' };
const actionBtnStyle     = { padding: '9px 18px', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer' };
const errStyle           = { color: '#f87171', fontSize: 13, marginTop: 10 };
const pendingRowStyle    = { background: '#1a1a2e', border: '1px solid #2d2d44', borderRadius: 10, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 };
const pendingFootnoteStyle = { fontSize: 11, color: '#374151', marginTop: 8 };

/* ─── [V153-WL] Withdrawal Limit helpers — appended by V153 ────────────────── */

/**
 * Check whether a withdrawal is within the user's available credit balance.
 * @param {number|null} balanceCredits  — current credit balance (credit units)
 * @param {number|null} amountUsd       — requested withdrawal amount (USD)
 * @returns {{ eligible: boolean, reason: string|null }}
 */
export function checkWithdrawalEligibility(balanceCredits, amountUsd) {
  if (balanceCredits == null || !isFinite(Number(balanceCredits))) {
    return { eligible: false, reason: 'Balance unavailable — try refreshing' };
  }
  const bal = Number(balanceCredits);
  const amt = Number(amountUsd);
  if (!isFinite(amt) || amt <= 0) {
    return { eligible: false, reason: 'Enter a valid amount greater than 0' };
  }
  if (amt > bal) {
    return {
      eligible: false,
      reason: `Insufficient credits — available: ${bal.toFixed(2)} ⊙`,
    };
  }
  return { eligible: true, reason: null };
}

/**
 * Format a credit balance for display in the WithdrawalPanel.
 * @param {number|null} balanceCredits
 * @returns {string}  e.g. "42.50 ⊙"
 */
export function formatAvailableBalance(balanceCredits) {
  if (balanceCredits == null || !isFinite(Number(balanceCredits))) return '— ⊙';
  return `${Number(balanceCredits).toFixed(2)} ⊙`;
}
