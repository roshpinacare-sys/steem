'use client';

/**
 * ECOS ISO 20022 Events Viewer — V117
 * ─────────────────────────────────────────────────────────────────────────────
 * Displays recent ISO 20022 wiring log events from
 * GET /api/v1/iso20022/events
 */

import React, { useState, useEffect, useCallback } from 'react';

const EXPRESS_BASE =
  typeof window !== 'undefined' && window.__ECOS_EXPRESS_URL__
    ? window.__ECOS_EXPRESS_URL__
    : (process.env.NEXT_PUBLIC_EXPRESS_URL || 'http://localhost:3000');

const EVENT_COLORS = {
  HITL_PAYOUT:   { bg: '#dcfce7', text: '#166534', label: 'HITL Payout' },
  ROYALTY_PAYOUT:{ bg: '#ede9fe', text: '#5b21b6', label: 'Royalty Payout' },
  TASK_CHARGE:   { bg: '#dbeafe', text: '#1e40af', label: 'Task Charge' },
};

function EventBadge({ type }) {
  const c = EVENT_COLORS[type] || { bg: '#f3f4f6', text: '#374151', label: type };
  return (
    <span style={{ background: c.bg, color: c.text, borderRadius: 6, padding: '3px 9px', fontSize: 11, fontWeight: 700 }}>
      {c.label}
    </span>
  );
}

function formatMicro(micro) {
  if (!micro && micro !== 0) return '—';
  return `$${(Number(micro) / 1_000_000).toFixed(4)}`;
}

export default function ISO20022Page() {
  const [events,   setEvents]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [limit,    setLimit]    = useState(50);
  const [source,   setSource]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (typeFilter) params.set('type', typeFilter);
      const res  = await fetch(`${EXPRESS_BASE}/api/v1/iso20022/events?${params}`, { credentials: 'include' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed to load events');
      setEvents(data.events || []);
      setSource(data.source);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, limit]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', padding: '32px 24px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>

        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 }}>ISO 20022 Event Log</h1>
          <p style={{ color: '#6b7280', margin: '6px 0 0', fontSize: 14 }}>
            Compliance-grade payment metadata — EU AI Act Art.12 audit trail · V117
          </p>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, background: '#fff', cursor: 'pointer' }}
          >
            <option value="">All event types</option>
            <option value="HITL_PAYOUT">HITL Payout</option>
            <option value="ROYALTY_PAYOUT">Royalty Payout</option>
            <option value="TASK_CHARGE">Task Charge</option>
          </select>
          <select
            value={limit}
            onChange={e => setLimit(Number(e.target.value))}
            style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, background: '#fff', cursor: 'pointer' }}
          >
            <option value={20}>Last 20</option>
            <option value={50}>Last 50</option>
            <option value={100}>Last 100</option>
          </select>
          <button
            onClick={load}
            style={{ padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            Refresh
          </button>
          {source && <span style={{ fontSize: 12, color: '#9ca3af' }}>Source: {source}</span>}
        </div>

        {error && (
          <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '12px 16px', color: '#991b1b', marginBottom: 16, fontSize: 13 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#9ca3af', fontSize: 14 }}>Loading events…</div>
        ) : events.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', color: '#9ca3af' }}>
            <div style={{ fontSize: 36, marginBottom: 10 }}>📄</div>
            <div style={{ fontSize: 14 }}>No ISO 20022 events yet. Use the wiring endpoints to generate events.</div>
          </div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  {['Type', 'Originator', 'Beneficiary', 'Amount', 'Currency', 'Reference', 'Timestamp'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((ev, i) => {
                  const type = ev.event_type || (ev.type ? ev.type.replace('_ISO20022','') : 'UNKNOWN');
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '10px 14px' }}><EventBadge type={type} /></td>
                      <td style={{ padding: '10px 14px', color: '#374151', fontFamily: 'monospace', fontSize: 11 }}>{ev.originator_id || ev.data?.originatorId || '—'}</td>
                      <td style={{ padding: '10px 14px', color: '#374151', fontFamily: 'monospace', fontSize: 11 }}>{ev.beneficiary_id || ev.data?.beneficiaryId || '—'}</td>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: '#111827' }}>{formatMicro(ev.amount_micro || ev.data?.amountMicro)}</td>
                      <td style={{ padding: '10px 14px', color: '#6b7280' }}>{ev.currency || ev.data?.currency || 'USD'}</td>
                      <td style={{ padding: '10px 14px', color: '#9ca3af', fontFamily: 'monospace', fontSize: 11 }}>{ev.reference_id || ev.data?.referenceId || '—'}</td>
                      <td style={{ padding: '10px 14px', color: '#9ca3af', fontSize: 11 }}>{ev.created_at || ev.ts ? new Date(ev.created_at || ev.ts).toLocaleString() : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 14, fontSize: 11, color: '#9ca3af', textAlign: 'right' }}>
          {events.length} event{events.length !== 1 ? 's' : ''} · ECOS V117 ISO 20022 Audit Log
        </div>
      </div>
    </div>
  );
}
