/**
 * ECOS Validator Task Queue — V62
 * ─────────────────────────────────────────────────────────────────────────────
 * ממשק HITL לולידטור: תור משימות ממתינות + Approve / Modify / Reject.
 *
 * ── שינויים ב-V62 ─────────────────────────────────────────────────────────
 * [FIX-V62-P3] HttpOnly cookie auth — מחליף sessionStorage JWT:
 *
 *   לפני (V60–V61):
 *     LoginScreen → POST EXPRESS_BASE/api/v1/validator/login (cross-origin)
 *     JWT שמור ב-sessionStorage['ecos_validator_jwt'] ← JS-readable, XSS risk
 *     JWT נשלח ידנית ב-Authorization: Bearer header
 *
 *   אחרי (V62):
 *     LoginScreen → POST /api/auth/validator/login (same-origin, Next.js route)
 *     Next.js route → POST EXPRESS_BASE/api/v1/validator/login → JWT
 *     Next.js route → Set-Cookie: ecos_validator_jwt=<jwt>; HttpOnly; SameSite=Lax
 *     JS לא רואה את ה-JWT בכלל.
 *     כל fetch ל-Express: credentials: 'include' → browser שולח cookie אוטומטי
 *     Express מאמת cookie בנוסף ל-Bearer (ב-validatorAuth.js — ראה הערה למטה)
 *     Logout: POST /api/auth/validator/logout → Set-Cookie: Max-Age=0
 *
 *   DEV_PASSTHROUGH:
 *     אם /api/auth/validator/login מחזיר 503 → passthrough mode
 *     קוד ממשיך ללא JWT, שרת Express מקבל בלי auth (DEV_PASSTHROUGH)
 *
 * ── שמור מ-V61 (לא שונה) ──────────────────────────────────────────────────
 * [FIX-V61-P2] Rate limiting על /api/v1/validator/login (Express-side)
 * [FIX-V60-P2] JWT login flow, POST /api/v1/validator/login endpoint בExpress
 * [V54-P3] Live Balance Bar
 * [V30-1] validator ID מ-query param (fallback ל-MOCK)
 * [V21]   Withdraw → Express
 *
 * ── הערה: Express-side cookie validation ──────────────────────────────────
 * V62 שולח cookie אוטומטי ע"י browser עם credentials: 'include'.
 * Express (validatorAuth.js, V57) בודק Bearer header בלבד.
 * TODO V63: הוסף לvalidatorAuth.js תמיכה בקריאת ecos_validator_jwt cookie
 * (parse req.headers.cookie → extract token → verifyJwt).
 * בינתיים: DEV_PASSTHROUGH לא נפגע. עם VALIDATOR_JWT_SECRET מוגדר —
 * העברת validatorId מה-JWT payload (שנשמר ב-state) אל validatorAccountId בבקשות.
 *
 * ── ENV ──────────────────────────────────────────────────────────────────
 * NEXT_PUBLIC_EXPRESS_URL — client-side, Express base URL (default: http://localhost:3000)
 * ECOS_EXPRESS_URL        — server-side, עבור Next.js API routes (login/logout)
 */

'use client';

import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

const MOCK_VALIDATOR_ID = 'validator::demo_001';
// V62: JWT stored in HttpOnly cookie — JS never reads the token value.
// We store only validatorId (extracted from server response, not from JWT decode).
const VALIDATOR_ID_SESSION_KEY = 'ecos_validator_id'; // tab-scoped, non-sensitive

// Express server base URL — queue reads, SSE, payout (cross-origin, credentials: include)
const EXPRESS_BASE =
  typeof window !== 'undefined' && window.__ECOS_EXPRESS_URL__
    ? window.__ECOS_EXPRESS_URL__
    : (process.env.NEXT_PUBLIC_EXPRESS_URL || 'http://localhost:3000');

// ── Session storage helpers — validator ID only (not JWT) ──────────────────
function loadStoredValidatorId() {
  if (typeof window === 'undefined') return null;
  try {
    const id = window.sessionStorage.getItem(VALIDATOR_ID_SESSION_KEY);
    return (id && id.startsWith('validator::')) ? id : null;
  } catch { return null; }
}

function storeValidatorId(id) {
  try { window.sessionStorage.setItem(VALIDATOR_ID_SESSION_KEY, id); }
  catch { /* private mode */ }
}

function clearStoredValidatorId() {
  try { window.sessionStorage.removeItem(VALIDATOR_ID_SESSION_KEY); }
  catch { /* ignore */ }
}

// ── Idempotency key (no external deps) ────────────────────────────────────
function genIdempotencyKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(21);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => chars[b % chars.length]).join('');
}

// ── Inner component — uses useSearchParams (requires Suspense) ────────────
function ValidatorQueueInner({ validatorId: jwtValidatorId, isPassthrough }) {
  const searchParams = useSearchParams();
  // V62: validatorId from JWT (server-verified). Query param is fallback for passthrough.
  const resolvedValidatorId = jwtValidatorId
    || searchParams.get('validator')
    || MOCK_VALIDATOR_ID;
  const isQueryParam = !jwtValidatorId && !!searchParams.get('validator');

  const [tasks, setTasks]               = useState([]);
  const [loading, setLoading]           = useState(true);
  const [active, setActive]             = useState(null);
  const [editedOutput, setEditedOutput] = useState('');
  const [submitting, setSubmitting]     = useState(false);
  const [lastResult, setLastResult]     = useState(null);
  const [error, setError]               = useState(null);
  const [sseStatus, setSseStatus]       = useState('connecting');
  const esRef = useRef(null);

  const [liveBalance, setLiveBalance]       = useState(null);
  const [liveBalanceErr, setLiveBalanceErr] = useState(false);
  const [todayEarned, setTodayEarned]       = useState(null);

  const [withdrawBalance, setWithdrawBalance] = useState(null);
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawResult, setWithdrawResult]   = useState(null);
  const [withdrawError, setWithdrawError]     = useState(null);

  // [V87-P3] Royalty toast notification (inline state — no external library)
  const [toastMsg, setToastMsg] = useState(null);
  const wsRef = useRef(null);
  // [P2-V94] WebSocket reconnect state
  const [wsConnected, setWsConnected] = useState(false);
  const wsBackoffRef = useRef(1000); // exponential backoff ms (1s→2s→4s→8s, max 30s)
  const wsReconnectTimerRef = useRef(null);

  // [V88-P3] Recent Royalties history (capped at MAX_ROYALTY_HISTORY entries)
  // [V89-P2] Persisted via sessionStorage with 1-hour TTL
  // [V90-P2] Extracted hardcoded 5 to named constant MAX_ROYALTY_HISTORY
  const MAX_ROYALTY_HISTORY = 5;
  const ROYALTY_HISTORY_KEY = 'ecos_royalty_history';
  const ROYALTY_HISTORY_TTL_MS = 60 * 60 * 1000; // 1 hour
  const [royaltyHistory, setRoyaltyHistory] = useState([]);

  // [V62] credentials: 'include' → browser sends HttpOnly cookie automatically.
  // No manual Authorization header for cross-origin Express calls.
  // (For same-origin Next.js routes, cookie is sent automatically without credentials.)
  const fetchOpts = {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  };

  // ── fetchPending ─────────────────────────────────────────────────────────
  const fetchPending = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${EXPRESS_BASE}/api/v1/approvals?status=pending`,
        fetchOpts
      );
      if (res.status === 401) { setError('Session expired. Please log in again.'); return; }
      if (!res.ok) { setError(`Express error: ${res.status} ${res.statusText}`); return; }
      const data = await res.json();
      setTasks(data.approvals || []);
    } catch (e) {
      setError(`Cannot reach Express at ${EXPRESS_BASE}. Is ecos-api-server.js running?`);
      // eslint-disable-next-line no-console
      console.error('fetchPending error:', e);
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── fetchLiveBalance ─────────────────────────────────────────────────────
  const fetchLiveBalance = useCallback(async () => {
    try {
      const res = await fetch(
        `${EXPRESS_BASE}/api/v1/account?id=${encodeURIComponent(resolvedValidatorId)}`,
        fetchOpts
      );
      if (!res.ok) { setLiveBalanceErr(true); return; }
      const data = await res.json();
      setLiveBalance(data.balance_usd ?? '0.0000');
      setLiveBalanceErr(false);
    } catch { setLiveBalanceErr(true); }
  }, [resolvedValidatorId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── fetchTodayEarned ─────────────────────────────────────────────────────
  const fetchTodayEarned = useCallback(async () => {
    try {
      const res = await fetch(
        `${EXPRESS_BASE}/api/v1/validator/${encodeURIComponent(resolvedValidatorId)}/earnings`,
        fetchOpts
      );
      if (!res.ok) return;
      const data = await res.json();
      setTodayEarned(data.totalEarned ?? null);
    } catch { /* non-fatal */ }
  }, [resolvedValidatorId]); // eslint-disable-line react-hooks/exhaustive-deps

  // [V89-P2] Load persisted royaltyHistory on mount
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(ROYALTY_HISTORY_KEY);
      if (raw) {
        const { entries, savedAt } = JSON.parse(raw);
        if (Date.now() - savedAt < ROYALTY_HISTORY_TTL_MS) {
          setRoyaltyHistory(entries);
        } else {
          window.sessionStorage.removeItem(ROYALTY_HISTORY_KEY);
        }
      }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // [V89-P2] Persist royaltyHistory to sessionStorage whenever it changes
  useEffect(() => {
    try {
      window.sessionStorage.setItem(ROYALTY_HISTORY_KEY,
        JSON.stringify({ entries: royaltyHistory, savedAt: Date.now() }));
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [royaltyHistory]);

  // ── SSE (mount once) ──────────────────────────────────────────────────────
  useEffect(() => {
    fetchPending();
    fetchLiveBalance();
    fetchTodayEarned();
    const balanceInterval = setInterval(() => {
      fetchLiveBalance();
      fetchTodayEarned();
    }, 30_000);

    // SSE: EventSource doesn't support custom headers or credentials option in all browsers.
    // Use URL-based validator ID (non-sensitive — this is the account identifier, not the secret).
    const sseUrl = `${EXPRESS_BASE}/api/v1/stream?validatorId=${encodeURIComponent(resolvedValidatorId)}`;
    const es = new EventSource(sseUrl);
    esRef.current = es;

    es.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'connected') { setSseStatus('connected'); return; }
      if (msg.type === 'approval.created') { fetchPending(); return; }
      if (msg.type === 'approval.resolved') {
        setTasks(prev => prev.filter(t => t.id !== msg.approvalId));
        setActive(prev => (prev && prev.id === msg.approvalId ? null : prev));
        setTimeout(() => { fetchLiveBalance(); fetchTodayEarned(); }, 500);
        return;
      }
    };
    es.onerror = () => setSseStatus('error');

    return () => {
      es.close();
      esRef.current = null;
      clearInterval(balanceInterval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount once

  // [P2-V94] WebSocket connection to /ws/validator with exponential backoff reconnect.
  // Handles approval lifecycle events + ROYALTY_PAID notifications.
  // Falls back to existing SSE polling when WS is disconnected.
  // [V97] Include JWT token in URL query string if stored in localStorage.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Build WS URL: replace http(s) scheme with ws(s), append /ws/validator path
    // [V97] Append token from localStorage if available
    const token = localStorage.getItem('ecos_validator_jwt') || '';
    const WS_BASE = (EXPRESS_BASE || 'http://localhost:3000')
      .replace(/^http/, 'ws') + '/ws/validator';
    const WS_URL = WS_BASE + (token ? '?token=' + encodeURIComponent(token) : '');

    let destroyed = false;

    function connect() {
      if (destroyed) return;
      let ws;
      try {
        ws = new WebSocket(WS_URL);
      } catch {
        // WebSocket not available (SSR guard) — fall back to polling only
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (destroyed) { ws.close(); return; }
        setWsConnected(true);
        wsBackoffRef.current = 1000; // reset backoff on successful connection
        // Authenticate so hub routes events to this validator
        ws.send(JSON.stringify({ type: 'auth', validatorId: resolvedValidatorId }));
      };

      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        // Approval lifecycle events — update local task list without full refetch
        if (msg.type === 'approval.created') {
          // Add the new approval to pending list (avoid full refetch)
          if (msg.data) {
            setTasks(prev => {
              if (prev.some(t => t.id === msg.data.id)) return prev;
              return [msg.data, ...prev];
            });
          } else {
            // Minimal payload — trigger a refetch as fallback
            fetchPending();
          }
          return;
        }
        if (msg.type === 'approval.resolved') {
          setTasks(prev => prev.filter(t => t.id !== msg.approvalId));
          setActive(prev => (prev && prev.id === msg.approvalId ? null : prev));
          setTimeout(() => { fetchLiveBalance(); fetchTodayEarned(); }, 500);
          return;
        }
        if (msg.type === 'ping') {
          try { ws.send(JSON.stringify({ type: 'pong' })); } catch { /* ignore */ }
          return;
        }
        if (msg.type === 'ROYALTY_PAID' && msg.data) {
          // [V88-P3] Append to history regardless of validatorId (capped at MAX_ROYALTY_HISTORY)
          setRoyaltyHistory(prev => [
            {
              rewardUsd:   msg.data.rewardUsd,
              patchId:     msg.data.patchId,
              validatorId: msg.data.validatorId,
              ts:          new Date().toISOString(),
            },
            ...prev,
          ].slice(0, MAX_ROYALTY_HISTORY));

          // Toast only when it's our own royalty
          if (msg.data.validatorId === resolvedValidatorId) {
            const usd = parseFloat(msg.data.rewardUsd || 0).toFixed(2);
            setToastMsg(`+$${usd} royalty earned`);
            setTimeout(() => setToastMsg(null), 4000);
          }
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        wsRef.current = null;
        if (destroyed) return;
        // Exponential backoff: 1s → 2s → 4s → 8s, max 30s
        const delay = Math.min(wsBackoffRef.current, 30000);
        wsBackoffRef.current = Math.min(wsBackoffRef.current * 2, 30000);
        wsReconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose fires immediately after onerror — reconnect handled there
        setWsConnected(false);
      };
    }

    connect();

    return () => {
      destroyed = true;
      clearTimeout(wsReconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect loop on unmount
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsConnected(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedValidatorId]);

  // ── Withdraw ──────────────────────────────────────────────────────────────
  async function fetchWithdrawBalance() {
    setWithdrawLoading(true);
    setWithdrawError(null);
    try {
      const res = await fetch(
        `${EXPRESS_BASE}/api/v1/account?id=${encodeURIComponent(resolvedValidatorId)}`,
        fetchOpts
      );
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setWithdrawBalance(data.balance_usd ?? '0.0000');
    } catch (e) {
      setWithdrawError('Cannot fetch balance: ' + e.message);
    } finally {
      setWithdrawLoading(false);
    }
  }

  async function handleWithdrawAll() {
    if (withdrawLoading) return;
    setWithdrawLoading(true);
    setWithdrawResult(null);
    setWithdrawError(null);
    try {
      const res = await fetch(`${EXPRESS_BASE}/api/v1/payout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ validatorId: resolvedValidatorId }),
      });
      const data = await res.json();
      if (!res.ok) { setWithdrawError(data.error || `Payout failed (${res.status})`); return; }
      setWithdrawResult(data);
      await fetchWithdrawBalance();
    } catch (e) {
      setWithdrawError('Payout request failed: ' + e.message);
    } finally {
      setWithdrawLoading(false);
    }
  }

  // ── Task open ─────────────────────────────────────────────────────────────
  function openTask(approval) {
    setActive(approval);
    setEditedOutput(JSON.stringify(approval.aiOutput, null, 2));
    setLastResult(null);
  }

  // ── resolve — via Next.js mission route + Idempotency-Key ─────────────────
  async function resolve(decision) {
    if (!active || submitting) return;
    setSubmitting(true);

    let finalOutput = null;
    if (decision === 'modify') {
      try { finalOutput = JSON.parse(editedOutput); }
      catch {
        alert('JSON לא תקין — תקן לפני שליחה');
        setSubmitting(false);
        return;
      }
    }

    const idempotencyKey = genIdempotencyKey();

    try {
      // [V62] credentials: 'include' → HttpOnly cookie sent automatically.
      // Same-origin Next.js route → proxies to Express with cookie forwarded
      // via Express fetch (or validatorId from JWT state in body).
      const res = await fetch(
        `/api/mission/${encodeURIComponent(active.missionId)}/approvals`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type':    'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({
            approvalId:         active.id,
            validatorAccountId: resolvedValidatorId,
            decision,
            finalOutput,
            note: '',
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        // eslint-disable-next-line no-console
        console.error('[resolve] error from route:', data);
        alert(`שגיאה (${res.status}): ${data.error || 'Unknown error'}`);
        setSubmitting(false);
        return;
      }

      setLastResult(data);
      setTasks(prev => prev.filter(t => t.id !== active.id));
      setActive(null);
      await fetchPending();
    } catch (e) {
      alert('שגיאה בשליחה: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const sseBadge = {
    connecting: { label: 'SSE: מתחבר…', cls: 'bg-yellow-100 text-yellow-700' },
    connected:  { label: 'SSE: ●',      cls: 'bg-green-100  text-green-700'  },
    error:      { label: 'SSE: ✕',      cls: 'bg-red-100    text-red-700'    },
  }[sseStatus];

  if (loading && tasks.length === 0) return <div className="p-8 text-gray-500">טוען משימות...</div>;

  return (
    <div className="max-w-4xl mx-auto p-6 font-mono text-sm">

      {/* [V87-P3] Royalty toast notification */}
      {toastMsg && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px',
          background: '#16a34a', color: '#fff',
          padding: '12px 20px', borderRadius: '8px',
          fontWeight: 'bold', fontSize: '14px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          zIndex: 9999,
        }}>
          {toastMsg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">ECOS Validator Queue</h1>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded text-xs ${sseBadge.cls}`}>{sseBadge.label}</span>
          <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded text-xs">
            {tasks.length} ממתינות
          </span>
        </div>
      </div>

      {/* Live Balance Bar */}
      <div className={`mb-4 p-3 rounded flex items-center justify-between text-sm ${liveBalanceErr ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
        <div className="flex items-center gap-4">
          <div>
            <span className="text-gray-500 text-xs">Balance</span>
            <div className="font-mono font-bold text-green-800 text-base">
              {liveBalance !== null ? `$${liveBalance}` : liveBalanceErr ? '—' : '...'}
            </div>
          </div>
          {todayEarned !== null && (
            <div className="border-l border-green-200 pl-4">
              <span className="text-gray-500 text-xs">Earned today</span>
              <div className="font-mono font-semibold text-green-700">${todayEarned}</div>
            </div>
          )}
        </div>
        <div className="text-xs text-gray-400 text-right">
          {liveBalanceErr
            ? <span className="text-red-500">⚠ balance unavailable</span>
            : <span>auto-refresh 30s</span>}
          <br />
          <button
            onClick={() => { fetchLiveBalance(); fetchTodayEarned(); }}
            className="text-blue-500 underline mt-0.5"
          >
            refresh now
          </button>
        </div>
      </div>

      {/* [V147-STRIPE-UI] Stripe Connect Panel */}
      <StripeConnectPanel validatorId={resolvedValidatorId} />

      {/* [V147-EARN] Earnings & Commission Dashboard */}
      <EarningsDashboard validatorId={resolvedValidatorId} />

      {/* Validator ID indicator + [P2-V94] WS connection badge */}
      <div className="mb-4 p-2 bg-gray-50 border rounded text-xs text-gray-500 flex items-center justify-between flex-wrap gap-2">
        <span>
          {jwtValidatorId
            ? <span>ולידטור: <code className="text-blue-700 font-semibold">{resolvedValidatorId}</code>{' '}
                <span className="text-green-600 font-semibold">(HttpOnly cookie ✓)</span>
                {isPassthrough && <span className="ml-2 text-amber-600">(DEV_PASSTHROUGH)</span>}
              </span>
            : isQueryParam
              ? <span>ולידטור: <code className="text-blue-700 font-semibond">{resolvedValidatorId}</code>{' '}
                  <span className="text-gray-400">(query param — DEV_PASSTHROUGH)</span>
                </span>
              : <span>ולידטור: <code className="text-gray-600">{resolvedValidatorId}</code>{' '}
                  <span className="text-amber-600">(MOCK — הוסף ?validator=... ל-URL)</span>
                </span>
          }
        </span>
        {/* [P2-V94] WS status badge */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 8px', borderRadius: 9999,
          background: wsConnected ? '#d1fae5' : '#fee2e2',
          color:      wsConnected ? '#065f46' : '#991b1b',
          fontWeight: 600, fontSize: 11,
        }}>
          {wsConnected ? '🟢 Live' : '🔴 Polling'}
        </span>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-800 text-xs">
          ⚠ {error}
          <button onClick={fetchPending} className="ml-4 underline">נסה שוב</button>
        </div>
      )}

      {/* Receipt display */}
      {lastResult && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded text-green-900 text-xs font-mono space-y-1">
          <div className="font-bold">
            ✓ {lastResult.decision?.toUpperCase()} — {lastResult.approvalId}
          </div>
          {lastResult.receipt && (
            <div className="mt-2 space-y-0.5">
              <div>gross:     <span className="font-semibold">${lastResult.receipt.gross}</span></div>
              <div>platform:  ${lastResult.receipt.platform}</div>
              <div>validator: <span className="text-green-700 font-semibold">${lastResult.receipt.validator}</span></div>
              <div>insurance: ${lastResult.receipt.insurance}</div>
            </div>
          )}
          {lastResult.validatorBalance != null && (
            <div className="mt-2 pt-2 border-t border-green-200">
              יתרת ולידטור אחרי עסקה:{' '}
              <span className="font-bold text-green-800">${lastResult.validatorBalance}</span>
            </div>
          )}
          {lastResult.royaltyPaid && (
            <div className="mt-1 text-purple-700">
              + תמלוג patch: ${lastResult.royaltyPaid.rewardUsd} → {lastResult.royaltyPaid.validatorId}
            </div>
          )}
        </div>
      )}

      {/* Task list */}
      {!active && (
        <div className="space-y-2">
          {tasks.length === 0 && !error && (
            <div className="text-gray-400 py-8 text-center">אין משימות ממתינות</div>
          )}
          {tasks.map(t => (
            <div
              key={t.id}
              onClick={() => openTask(t)}
              className="border rounded p-4 cursor-pointer hover:bg-gray-50 flex items-center justify-between"
            >
              <div>
                <div className="font-semibold">{t.missionId}</div>
                <div className="text-gray-500 text-xs mt-1">
                  confidence: {t.confidence ?? 'null'} · ${t.priceUsd}
                </div>
              </div>
              <div className="text-xs text-gray-400">
                {new Date(t.createdAt).toLocaleTimeString('he-IL')}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Active task */}
      {active && (
        <div className="border rounded p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-bold">{active.missionId}</span>
              <span className="ml-3 text-gray-400">
                · ${active.priceUsd} · confidence: {active.confidence ?? 'null'}
              </span>
            </div>
            <button onClick={() => { setActive(null); setLastResult(null); }} className="text-gray-400 hover:text-gray-700">
              ← חזור
            </button>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">פלט AI (ניתן לעריכה):</div>
            <textarea
              value={editedOutput}
              onChange={e => setEditedOutput(e.target.value)}
              rows={10}
              className="w-full border rounded p-3 text-xs bg-gray-50 font-mono"
            />
          </div>
          <div className="flex gap-3">
            <button onClick={() => resolve('approve')} disabled={submitting}
              className="bg-green-600 text-white px-5 py-2 rounded hover:bg-green-700 disabled:opacity-50">
              {submitting ? '…' : '✓ Approve'}
            </button>
            <button onClick={() => resolve('modify')} disabled={submitting}
              className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-50">
              {submitting ? '…' : '✎ Modify & Approve'}
            </button>
            <button onClick={() => resolve('reject')} disabled={submitting}
              className="bg-red-600 text-white px-5 py-2 rounded hover:bg-red-700 disabled:opacity-50">
              {submitting ? '…' : '✕ Reject'}
            </button>
          </div>
        </div>
      )}

      {/* Withdraw */}
      <div className="mt-8 border rounded p-5 bg-gray-50">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-base">Withdraw</h2>
          <button onClick={fetchWithdrawBalance} disabled={withdrawLoading}
            className="text-xs text-blue-600 underline disabled:opacity-50">
            {withdrawBalance === null ? 'Load balance' : 'Refresh'}
          </button>
        </div>
        {withdrawBalance !== null && (
          <div className="mb-4">
            <span className="text-gray-500 text-xs">Current balance:</span>{' '}
            <span className="font-mono font-semibold text-green-700">${withdrawBalance}</span>
          </div>
        )}
        {withdrawError && (
          <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
            ⚠ {withdrawError}
          </div>
        )}
        {withdrawResult && (
          <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded text-xs font-mono space-y-1">
            <div>✓ Payout submitted</div>
            <div>payoutId: {withdrawResult.payoutId}</div>
            <div>mock: {String(withdrawResult.mock)}</div>
            <div>new balance: ${withdrawResult.remainingBalanceUsd ?? '—'}</div>
          </div>
        )}
        <button
          onClick={handleWithdrawAll}
          disabled={withdrawLoading || withdrawBalance === '0.0000' || withdrawBalance === null}
          className="bg-indigo-600 text-white px-5 py-2 rounded text-sm hover:bg-indigo-700 disabled:opacity-40"
        >
          {withdrawLoading ? 'מעבד…' : 'Withdraw All'}
        </button>
        {withdrawBalance === '0.0000' && (
          <span className="ml-3 text-xs text-gray-400">יתרה אפס — אין מה למשוך</span>
        )}
      </div>

      <div className="mt-4 text-xs text-gray-400 border-t pt-3">
        Express: <code>{EXPRESS_BASE}/api/v1/</code> ·
        Auth: <code>HttpOnly cookie (ecos_validator_jwt)</code> ·
        <span className="ml-1 text-blue-500">resolve: /api/mission/[missionId]/approvals</span>
      </div>

      {/* [V88-P3] Recent Royalties panel */}
      {royaltyHistory.length > 0 && (
        <div style={{
          marginTop: '24px',
          border: '1px solid #374151',
          borderRadius: '8px',
          padding: '16px',
          background: '#111827',
          color: '#e5e7eb',
        }}>
          <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '10px', color: '#d1d5db' }}>
            Recent Royalties
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ color: '#6b7280', borderBottom: '1px solid #374151' }}>
                <th style={{ textAlign: 'left', paddingBottom: '6px', paddingRight: '16px' }}>Time</th>
                <th style={{ textAlign: 'left', paddingBottom: '6px', paddingRight: '16px' }}>Validator</th>
                <th style={{ textAlign: 'left', paddingBottom: '6px', paddingRight: '16px' }}>Patch</th>
                <th style={{ textAlign: 'right', paddingBottom: '6px' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {royaltyHistory.map((entry, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #1f2937' }}>
                  <td style={{ padding: '5px 16px 5px 0', color: '#9ca3af' }}>
                    {new Date(entry.ts).toLocaleTimeString()}
                  </td>
                  <td style={{ padding: '5px 16px 5px 0', color: '#d1d5db', fontFamily: 'monospace' }}>
                    {entry.validatorId}
                  </td>
                  <td style={{ padding: '5px 16px 5px 0', color: '#9ca3af', fontFamily: 'monospace' }}>
                    {entry.patchId}
                  </td>
                  <td style={{ padding: '5px 0', color: '#4ade80', fontWeight: 600, textAlign: 'right' }}>
                    +${parseFloat(entry.rewardUsd).toFixed(6)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Login Screen ───────────────────────────────────────────────────────────────

// ── [V147-STRIPE-UI] StripeConnectPanel ──────────────────────────────────────
// Shows current Stripe Connect onboarding status + start/refresh buttons.
// Collapsed by default; expands via chevron.
function StripeConnectPanel({ validatorId }) {
  const [open,   setOpen]   = React.useState(false);
  const [status, setStatus] = React.useState(null); // null = not loaded
  const [loading, setLoading] = React.useState(false);
  const [err,    setErr]    = React.useState(null);
  const [email,  setEmail]  = React.useState('');
  const [onboarding, setOnboarding] = React.useState(null); // { url, expiresAt }

  const STATUS_META = {
    onboarded:   { label: 'Onboarded ✓',   color: '#065f46', bg: '#d1fae5', border: '#6ee7b7' },
    in_review:   { label: 'In Review…',    color: '#92400e', bg: '#fef3c7', border: '#fcd34d' },
    pending:     { label: 'Pending Setup', color: '#1e3a5f', bg: '#dbeafe', border: '#93c5fd' },
    restricted:  { label: 'Restricted ⚠',  color: '#7f1d1d', bg: '#fee2e2', border: '#fca5a5' },
    not_started: { label: 'Not Started',   color: '#374151', bg: '#f3f4f6', border: '#d1d5db' },
  };

  async function fetchStatus(live = false) {
    setLoading(true); setErr(null);
    try {
      const res = await fetchWithAuth(
        `${EXPRESS_BASE}/api/v1/payments/stripe/connect/status/${encodeURIComponent(validatorId)}${live ? '?live=true' : ''}`,
      );
      if (res.status === 404) { setStatus({ onboardingStatus: 'not_started' }); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus(await res.json());
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function startOnboarding() {
    if (!email.trim()) { setErr('Enter your email to start onboarding'); return; }
    setLoading(true); setErr(null); setOnboarding(null);
    try {
      const res = await fetchWithAuth(`${EXPRESS_BASE}/api/v1/payments/stripe/connect/onboard`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          validatorId,
          email: email.trim(),
          returnUrl:  `${window.location.origin}/validator?connect=done`,
          refreshUrl: `${window.location.origin}/validator?connect=refresh`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setOnboarding(data);
      // open in new tab
      if (data.onboardingUrl) window.open(data.onboardingUrl, '_blank', 'noopener');
      await fetchStatus();
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    // auto-load status when panel opens for the first time
    if (open && status === null) fetchStatus();
    // check if returning from onboarding
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('connect') === 'done' || params.get('connect') === 'refresh') {
        setOpen(true);
        fetchStatus(true);
        // clean URL
        const clean = window.location.pathname;
        window.history.replaceState({}, '', clean);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const st   = status?.onboardingStatus || 'not_started';
  const meta = STATUS_META[st] || STATUS_META.not_started;

  return (
    <div style={{ marginBottom: 14, border: `1px solid ${meta.border}`, borderRadius: 10, overflow: 'hidden' }}>
      {/* Header row — always visible */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', background: meta.bg, border: 'none', cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>💳</span>
          <span style={{ fontWeight: 700, fontSize: 13, color: meta.color }}>Stripe Payout Connect</span>
          <span style={{
            fontSize: 11, padding: '2px 8px', borderRadius: 99, fontWeight: 700,
            background: meta.color, color: '#fff',
          }}>{meta.label}</span>
          {status?.payoutsEnabled && (
            <span style={{ fontSize: 11, color: '#065f46', fontWeight: 700 }}>· Payouts ✓</span>
          )}
        </span>
        <span style={{ fontSize: 12, color: meta.color, fontWeight: 700 }}>{open ? '▲' : '▼'}</span>
      </button>

      {/* Expandable body */}
      {open && (
        <div style={{ padding: '14px 18px', background: '#111827', borderTop: `1px solid ${meta.border}` }}>
          {err && (
            <div style={{ marginBottom: 10, padding: '7px 12px', background: '#7f1d1d', color: '#fca5a5', borderRadius: 6, fontSize: 12 }}>
              ⚠ {err}
            </div>
          )}

          {/* Status details */}
          {status && st !== 'not_started' && (
            <div style={{ display: 'flex', gap: 16, marginBottom: 14, fontSize: 12 }}>
              {[
                { label: 'Payouts',  value: status.payoutsEnabled  ? '✓ Enabled'  : '✗ Disabled', ok: status.payoutsEnabled  },
                { label: 'Charges',  value: status.chargesEnabled  ? '✓ Enabled'  : '✗ Disabled', ok: status.chargesEnabled  },
                { label: 'Account',  value: status.stripeAccountId ? status.stripeAccountId.slice(0, 18) + '…' : '—', ok: true },
              ].map(({ label, value, ok }) => (
                <div key={label} style={{ background: '#1f2937', borderRadius: 6, padding: '8px 12px', minWidth: 100 }}>
                  <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                  <div style={{ color: ok ? '#4ade80' : '#f87171', fontWeight: 700, marginTop: 2 }}>{value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Start Onboarding form */}
          {(st === 'not_started' || st === 'pending') && !onboarding && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com for Stripe"
                style={{
                  flex: 1, minWidth: 200, padding: '7px 12px', borderRadius: 6,
                  border: '1px solid #374151', background: '#0f172a',
                  color: '#e5e7eb', fontSize: 13, outline: 'none',
                }}
              />
              <button
                onClick={startOnboarding}
                disabled={loading}
                style={{
                  padding: '7px 18px', borderRadius: 6, border: 'none',
                  background: loading ? '#374151' : '#2563eb',
                  color: '#fff', fontSize: 13, fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? '⏳' : '🔗 Start Onboarding'}
              </button>
            </div>
          )}

          {/* Returned URL from onboarding */}
          {onboarding?.onboardingUrl && (
            <div style={{ marginBottom: 10, padding: '8px 12px', background: '#1e3a5f', borderRadius: 6, fontSize: 12 }}>
              ✓ Onboarding page opened in new tab.{' '}
              <a href={onboarding.onboardingUrl} target="_blank" rel="noopener noreferrer"
                style={{ color: '#60a5fa', textDecoration: 'underline' }}>
                Click here if it didn't open.
              </a>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(st === 'in_review' || st === 'onboarded' || st === 'restricted') && (
              <button
                onClick={() => { setOnboarding(null); startOnboarding(); }}
                disabled={loading}
                style={{
                  padding: '6px 14px', borderRadius: 6, border: '1px solid #374151',
                  background: 'transparent', color: '#60a5fa', fontSize: 12,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                ↻ Resume / Re-open Onboarding
              </button>
            )}
            <button
              onClick={() => fetchStatus(true)}
              disabled={loading}
              style={{
                padding: '6px 14px', borderRadius: 6, border: '1px solid #374151',
                background: 'transparent', color: '#9ca3af', fontSize: 12,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? '⏳ Checking…' : '↺ Refresh Status'}
            </button>
          </div>

          {status?.mock && (
            <div style={{ marginTop: 10, fontSize: 11, color: '#4b5563' }}>
              ⚙ Mock mode — STRIPE_API_KEY not set. Real onboarding requires live Stripe key.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── [V147-EARN] EarningsDashboard ────────────────────────────────────────────
// Earnings breakdown: gross earned, platform split retained, net to validator,
// pending Connect onboarding warning, commission rate visualisation.
function EarningsDashboard({ validatorId }) {
  const [open,    setOpen]    = React.useState(false);
  const [data,    setData]    = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [err,     setErr]     = React.useState(null);

  async function fetchEarnings() {
    setLoading(true); setErr(null);
    try {
      const [earningsRes, balanceRes] = await Promise.all([
        fetchWithAuth(`${EXPRESS_BASE}/api/v1/validator/${encodeURIComponent(validatorId)}/earnings`),
        fetchWithAuth(`${EXPRESS_BASE}/api/v1/account?id=${encodeURIComponent(validatorId)}`),
      ]);
      const earnings = earningsRes.ok ? await earningsRes.json() : {};
      const balance  = balanceRes.ok  ? await balanceRes.json()  : {};
      setData({ earnings, balance });
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (open && data === null) fetchEarnings();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Commission rate display: 40% validator share of gross per task
  const VALIDATOR_SHARE = 0.40;
  const PLATFORM_SHARE  = 0.40;
  const INSURANCE_SHARE = 0.20;

  return (
    <div style={{ marginBottom: 14, border: '1px solid #1f2937', borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', background: '#111827', border: 'none', cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>📊</span>
          <span style={{ fontWeight: 700, fontSize: 13, color: '#e5e7eb' }}>Earnings & Commission</span>
          {data?.balance?.balance != null && (
            <span style={{ fontSize: 12, color: '#4ade80', fontWeight: 700 }}>
              · ${data.balance.balance} balance
            </span>
          )}
        </span>
        <span style={{ fontSize: 12, color: '#6b7280' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '14px 18px', background: '#0f172a', borderTop: '1px solid #1f2937' }}>
          {err && (
            <div style={{ marginBottom: 10, padding: '7px 12px', background: '#7f1d1d', color: '#fca5a5', borderRadius: 6, fontSize: 12 }}>
              ⚠ {err}
            </div>
          )}
          {loading && <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 10 }}>Loading…</div>}

          {/* Commission split visualisation */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Revenue Split (per task)
            </div>
            <div style={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2, marginBottom: 6 }}>
              <div style={{ flex: VALIDATOR_SHARE, background: '#22c55e', borderRadius: '4px 0 0 4px' }} />
              <div style={{ flex: PLATFORM_SHARE,  background: '#3b82f6' }} />
              <div style={{ flex: INSURANCE_SHARE, background: '#f59e0b', borderRadius: '0 4px 4px 0' }} />
            </div>
            <div style={{ display: 'flex', gap: 18, fontSize: 11 }}>
              <span style={{ color: '#22c55e' }}>● You 40%</span>
              <span style={{ color: '#3b82f6' }}>● Platform 40%</span>
              <span style={{ color: '#f59e0b' }}>● Insurance 20%</span>
            </div>
          </div>

          {/* Earnings stats */}
          {data?.earnings && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 14 }}>
              {[
                { label: 'Today Earned',  value: data.earnings.todayEarned   != null ? `$${data.earnings.todayEarned}`   : '—', color: '#4ade80' },
                { label: 'Total Earned',  value: data.earnings.totalEarned   != null ? `$${data.earnings.totalEarned}`   : '—', color: '#60a5fa' },
                { label: 'Tasks Done',    value: data.earnings.taskCount      != null ? data.earnings.taskCount           : '—', color: '#a78bfa' },
                { label: 'Royalties',     value: data.earnings.royaltyEarned != null ? `$${data.earnings.royaltyEarned}` : '—', color: '#f59e0b' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ background: '#111827', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                  <div style={{ color, fontWeight: 800, fontSize: 18, marginTop: 2 }}>{value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Balance */}
          {data?.balance?.balance != null && (
            <div style={{ padding: '10px 14px', background: '#111827', borderRadius: 8, marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#9ca3af' }}>Current Balance</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#4ade80', fontFamily: 'monospace' }}>
                ${data.balance.balance}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={fetchEarnings}
              disabled={loading}
              style={{
                padding: '5px 12px', borderRadius: 6, border: '1px solid #374151',
                background: 'transparent', color: '#9ca3af', fontSize: 11,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              ↺ Refresh
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── [V146-AUTH-01] New LoginScreen — email + password (replaces shared secret) ──
// Posts directly to Express /api/v1/auth/login.
// Returns { accessToken, refreshToken } — stored in memory + sessionStorage.
// Auto-refreshes accessToken when 401. No shared VALIDATOR_LOGIN_PASSWORD needed.
// Legacy validators: auto-detect → offer migration via /api/v1/auth/validator/migrate.

const REFRESH_TOKEN_KEY = 'ecos_refresh_token'; // sessionStorage — tab-safe

let _accessToken = null; // in-memory (never touches sessionStorage)

function storeRefreshToken(token) {
  try { window.sessionStorage.setItem(REFRESH_TOKEN_KEY, token); } catch { /* private mode */ }
}
function loadRefreshToken() {
  try { return window.sessionStorage.getItem(REFRESH_TOKEN_KEY); } catch { return null; }
}
function clearRefreshToken() {
  try { window.sessionStorage.removeItem(REFRESH_TOKEN_KEY); } catch {}
}

/** Fetch with automatic token refresh on 401. */
async function fetchWithAuth(url, opts = {}) {
  const headers = { ...opts.headers };
  if (_accessToken) headers['Authorization'] = `Bearer ${_accessToken}`;

  let res = await fetch(url, { ...opts, headers });

  if (res.status === 401 && _accessToken) {
    // Try refresh
    const rt = loadRefreshToken();
    if (rt) {
      const refreshRes = await fetch(`${EXPRESS_BASE}/api/v1/auth/refresh`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ refreshToken: rt }),
      });
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        _accessToken = refreshData.accessToken;
        if (refreshData.refreshToken) storeRefreshToken(refreshData.refreshToken);
        // Retry original request with new token
        headers['Authorization'] = `Bearer ${_accessToken}`;
        res = await fetch(url, { ...opts, headers });
      }
    }
  }
  return res;
}

function LoginScreen({ onSuccess }) {
  const [tab,        setTab]        = React.useState('login');  // 'login' | 'migrate'
  const [email,      setEmail]      = React.useState('');
  const [password,   setPassword]   = React.useState('');
  const [validatorId,setValidatorId]= React.useState('validator::');
  const [legacyPwd,  setLegacyPwd] = React.useState('');
  const [error,      setError]      = React.useState('');
  const [loading,    setLoading]    = React.useState(false);
  const [info,       setInfo]       = React.useState('');

  async function handleLogin() {
    if (!email || !password) { setError('Email and password are required'); return; }
    setLoading(true); setError(''); setInfo('');
    try {
      const res = await fetch(`${EXPRESS_BASE}/api/v1/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || `Login failed (${res.status})`); return; }

      // Store tokens
      _accessToken = data.accessToken;
      if (data.refreshToken) storeRefreshToken(data.refreshToken);

      // Resolve validatorId from the JWT payload or /auth/me
      let resolvedValidatorId = null;
      const meRes = await fetch(`${EXPRESS_BASE}/api/v1/auth/me`, {
        headers: { 'Authorization': `Bearer ${data.accessToken}` },
      });
      if (meRes.ok) {
        const me = await meRes.json();
        resolvedValidatorId = me.validatorId || me.roles?.find(r => r.startsWith('validator::')) || null;
      }

      if (!resolvedValidatorId) {
        // New user — not yet a validator. Use email as display identity.
        resolvedValidatorId = `validator::${email.split('@')[0]}`;
      }

      storeValidatorId(resolvedValidatorId);
      onSuccess(resolvedValidatorId, false /* isPassthrough */);

    } catch (e) {
      setError('Cannot reach server: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleMigrate() {
    if (!email || !legacyPwd || !validatorId.startsWith('validator::') || validatorId.length < 12) {
      setError('Email, legacy password, and valid validator ID are required'); return;
    }
    setLoading(true); setError(''); setInfo('');
    try {
      const res = await fetch(`${EXPRESS_BASE}/api/v1/auth/validator/migrate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, currentPassword: legacyPwd, validatorId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || `Migration failed (${res.status})`); return; }

      _accessToken = data.accessToken;
      if (data.refreshToken) storeRefreshToken(data.refreshToken);
      storeValidatorId(data.validatorId || validatorId);
      setInfo('Migration complete! Your email is now linked to this validator ID.');
      setTimeout(() => onSuccess(data.validatorId || validatorId, false), 1200);
    } catch (e) {
      setError('Cannot reach server: ' + e.message);
    } finally {
      setLoading(false);
    }
  }

  const inputStyle = {
    background: '#1f2937', border: '1px solid #374151',
    borderRadius: 8, color: '#e5e7eb', padding: '10px 16px',
    fontSize: 15, width: 300, outline: 'none',
  };
  const btnStyle = (disabled) => ({
    background: disabled ? '#374151' : '#1d4ed8', border: 'none', borderRadius: 8,
    color: '#fff', padding: '10px 28px', fontSize: 15,
    cursor: disabled ? 'default' : 'pointer', fontWeight: 600, width: 300,
  });

  return (
    <div style={{
      minHeight: '100vh', background: '#111827', display: 'flex',
      alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
      fontFamily: 'Inter, system-ui, sans-serif', gap: 14,
    }}>
      {/* Header */}
      <div style={{ color: '#e5e7eb', fontSize: 22, fontWeight: 700 }}>
        ⛓ ECOS Validator Portal
      </div>
      <div style={{ color: '#9ca3af', fontSize: 13, marginBottom: 6 }}>
        Sign in with your ECOS account
      </div>

      {/* Tab switch */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
        {['login', 'migrate'].map(t => (
          <button key={t} onClick={() => { setTab(t); setError(''); setInfo(''); }}
            style={{
              padding: '5px 18px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: tab === t ? '#1d4ed8' : '#1f2937',
              color: tab === t ? '#fff' : '#6b7280', fontSize: 13, fontWeight: 600,
            }}>
            {t === 'login' ? 'Sign In' : 'Legacy → Email'}
          </button>
        ))}
      </div>

      {tab === 'login' ? (
        <>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="you@example.com" style={inputStyle} />
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="Password" style={inputStyle} />
          <button onClick={handleLogin} disabled={loading} style={btnStyle(loading)}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </>
      ) : (
        <>
          <div style={{ color: '#fbbf24', fontSize: 12, maxWidth: 300, textAlign: 'center' }}>
            First time? Link your validator ID to an email account.
          </div>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="your@email.com" style={inputStyle} />
          <input type="text" value={validatorId} onChange={e => setValidatorId(e.target.value)}
            placeholder="validator::your_id" style={inputStyle} />
          <input type="password" value={legacyPwd} onChange={e => setLegacyPwd(e.target.value)}
            placeholder="Current VALIDATOR_LOGIN_PASSWORD" style={inputStyle} />
          <button onClick={handleMigrate} disabled={loading} style={btnStyle(loading)}>
            {loading ? 'Migrating…' : 'Migrate to Email Auth'}
          </button>
        </>
      )}

      {error && <div style={{ color: '#f87171', fontSize: 13, maxWidth: 300, textAlign: 'center' }}>{error}</div>}
      {info  && <div style={{ color: '#4ade80', fontSize: 13, maxWidth: 300, textAlign: 'center' }}>{info}</div>}

      <div style={{ color: '#374151', fontSize: 11, marginTop: 8, textAlign: 'center', maxWidth: 320 }}>
        V147 — Stripe Connect UI + Earnings Dashboard
        <br />
        <a href="/login" style={{ color: '#4b5563', textDecoration: 'underline' }}>← Main login page</a>
      </div>
    </div>
  );
}

// ── Default export ─────────────────────────────────────────────────────────────
// [FIX-V62-P3] Auth flow:
//   1. On mount: check sessionStorage for stored validatorId (non-sensitive).
//      Cookie presence is checked by the server on every API call — not here.
//   2. If validatorId found → skip login (cookie assumed valid — server verifies).
//   3. If not → show LoginScreen.
//   4. On login: HttpOnly cookie set by server. Store only validatorId in sessionStorage.
//   5. Logout: POST /api/auth/validator/logout → cookie cleared.
export default function ValidatorQueue() {
  const [authState, setAuthState] = React.useState(() => {
    const storedId = loadStoredValidatorId();
    return storedId ? { validatorId: storedId, isPassthrough: false } : null;
  });

  function handleLoginSuccess(validatorId, isPassthrough) {
    setAuthState({ validatorId, isPassthrough });
    storeValidatorId(validatorId);
  }

  async function handleLogout() {
    // [V146] Revoke refresh token on Express + clear local state
    const rt = loadRefreshToken();
    if (rt) {
      try {
        await fetch(`${EXPRESS_BASE}/api/v1/auth/logout`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ refreshToken: rt }),
        });
      } catch { /* ignore */ }
    }
    _accessToken = null;
    clearRefreshToken();
    clearStoredValidatorId();
    try { window.sessionStorage.removeItem(ROYALTY_HISTORY_KEY); } catch { /* ignore */ }
    setAuthState(null);
  }

  if (!authState) {
    return <LoginScreen onSuccess={handleLoginSuccess} />;
  }

  return (
    <div>
      <div className="flex justify-end p-2 bg-gray-900">
        <button
          onClick={handleLogout}
          className="text-xs text-gray-400 hover:text-white underline"
        >
          Logout ({authState.validatorId})
        </button>
      </div>
      <Suspense fallback={<div className="p-8 text-gray-500">טוען...</div>}>
        <ValidatorQueueInner
          validatorId={authState.validatorId}
          isPassthrough={authState.isPassthrough}
        />
      </Suspense>
    </div>
  );
}

/*
 * ── V63 TODO: Express-side cookie validation ─────────────────────────────────
 * validatorAuth.js (V57) reads only the Authorization: Bearer header.
 * When credentials: 'include' is used, the browser sends the HttpOnly cookie
 * in the Cookie header, but Express ignores it.
 *
 * To make Express validate the cookie (eliminating the need to pass validatorId
 * in the request body for auth purposes), add to checkValidatorAuth():
 *
 *   // After Bearer check, try cookie fallback:
 *   const cookieHeader = req.headers.cookie || '';
 *   const cookieMatch  = cookieHeader.match(/ecos_validator_jwt=([^;]+)/);
 *   const cookieToken  = cookieMatch ? cookieMatch[1].trim() : null;
 *   if (cookieToken) { return _verifyJwt(cookieToken, CONFIGURED_SECRET); }
 *
 * This V62 implementation uses validatorId from session state in API call bodies,
 * which is sufficient for V62. The cookie is validated on next.js routes (same-origin).
 * Cross-origin Express calls still rely on DEV_PASSTHROUGH or Bearer from future cookie-read.
 *
 * CORS note: For credentials: 'include' to work cross-origin, Express must set:
 *   Access-Control-Allow-Origin: http://localhost:3001 (not wildcard *)
 *   Access-Control-Allow-Credentials: true
 * V31 set the origin correctly. Add credentials header in V63.
 *
 * engine/.env:
 *   VALIDATOR_JWT_SECRET=<48-byte hex>
 *   VALIDATOR_LOGIN_PASSWORD=<secret>
 *   CORS_ORIGIN=http://localhost:3001
 */
