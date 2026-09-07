/**
 * NotificationNavItem — V153
 * ─────────────────────────────────────────────────────────────────────────────
 * [V153-NB] Real-time unread notification badge in the nav.
 *
 * - Polls GET /api/v1/rank/notifications/:userId?unreadOnly=true&limit=1 every 30 s.
 * - Shows a red badge when unread count > 0; auto-hides when count reaches 0.
 * - Reads userId from the same localStorage key as session.js (no Provider needed).
 * - Exported pure helpers: computeUnreadBadge, formatBadgeCount (unit-testable).
 *
 * No SessionProvider dependency — reads localStorage directly so it works at the
 * layout level (server component root) without an additional client wrapper.
 */

'use client';

import { useState, useEffect, useRef } from 'react';

const API_BASE    = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL) || '';
const SESSION_KEY = 'ecos_session_v37';
const POLL_MS     = 30_000;

// ─── Pure helpers (exported for unit tests) ──────────────────────────────────

/**
 * Return the badge label string for a given unread count, or null if no badge.
 * @param {number|null} count
 * @returns {string|null}
 */
export function computeUnreadBadge(count) {
  const n = parseInt(count, 10);
  if (!isFinite(n) || n < 1) return null;
  return n > 99 ? '99+' : String(n);
}

/**
 * Parse a raw count value (possibly a string or float) into a badge display string.
 * @param {*} raw
 * @returns {string|null}
 */
export function formatBadgeCount(raw) {
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : parseFloat(raw);
  if (!isFinite(n) || n < 1) return null;
  return n > 99 ? '99+' : String(Math.floor(n));
}

/** Read validatorId from localStorage (same key used by session.js). */
function readUserIdFromStorage() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s?.validatorId || null;
  } catch {
    return null;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function NotificationNavItem() {
  const [count,  setCount]  = useState(0);
  const [userId, setUserId] = useState(null);
  const intervalRef = useRef(null);

  // Resolve userId on mount (localStorage not available server-side)
  useEffect(() => {
    setUserId(readUserIdFromStorage());
  }, []);

  const fetchUnread = async (uid) => {
    if (!uid) return;
    try {
      const res = await fetch(
        `${API_BASE}/api/v1/rank/notifications/${encodeURIComponent(uid)}?unreadOnly=true&limit=1`,
        { cache: 'no-store' }
      ).catch(() => null);
      if (!res || !res.ok) return;
      const data = await res.json().catch(() => null);
      const n = data?.total ?? data?.count ?? (Array.isArray(data?.notifications) ? data.notifications.length : 0);
      setCount(Number(n) || 0);
    } catch { /* badge is non-critical — fail silently */ }
  };

  useEffect(() => {
    if (!userId) return;
    fetchUnread(userId);
    intervalRef.current = setInterval(() => fetchUnread(userId), POLL_MS);
    return () => clearInterval(intervalRef.current);
  }, [userId]);

  const badge = computeUnreadBadge(count);

  return (
    <a
      href="/notifications"
      className="ecos-nav-link"
      aria-label={badge ? `Notifications — ${badge} unread` : 'Notifications'}
      style={{
        color:          '#9ca3af',
        fontSize:       14,
        fontWeight:     500,
        padding:        '6px 14px',
        borderRadius:   6,
        transition:     'color 0.15s, background 0.15s',
        background:     'transparent',
        display:        'inline-flex',
        alignItems:     'center',
        gap:            5,
        textDecoration: 'none',
      }}
    >
      🔔 Notifications
      {badge && (
        <span
          role="status"
          aria-live="polite"
          style={{
            background:   '#dc2626',
            color:        '#fff',
            borderRadius: 999,
            padding:      '1px 6px',
            fontSize:     11,
            fontWeight:   700,
            lineHeight:   1.4,
            minWidth:     18,
            textAlign:    'center',
            display:      'inline-block',
          }}
        >
          {badge}
        </span>
      )}
    </a>
  );
}
