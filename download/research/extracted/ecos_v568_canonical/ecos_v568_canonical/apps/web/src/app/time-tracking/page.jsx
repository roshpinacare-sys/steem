'use client';
/**
 * apps/web/src/app/time-tracking/page.jsx — V162
 * Task Time Tracking — workspace leaderboard + per-task time summary
 */
import { useState, useEffect } from 'react';

export default function TimeTrackingPage() {
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading]         = useState(true);
  const workspaceId = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('workspaceId') || 'ws-default'
    : 'ws-default';

  useEffect(() => {
    fetch(`/api/v1/workspaces/${workspaceId}/time/leaderboard`)
      .then(r => r.json())
      .then(d => { if (d.ok) setLeaderboard(d.leaderboard || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [workspaceId]);

  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif', maxWidth: 800, margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>⏱ Time Tracking Leaderboard</h1>
      {loading ? (
        <p>Loading…</p>
      ) : leaderboard.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No time entries logged yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f3f4f6' }}>
              <th style={{ padding: '0.5rem', textAlign: 'left' }}>Rank</th>
              <th style={{ padding: '0.5rem', textAlign: 'left' }}>User</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Total Hours</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map(row => (
              <tr key={row.userId} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: '0.5rem' }}>#{row.rank}</td>
                <td style={{ padding: '0.5rem' }}>{row.userId}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{row.totalHrs.toFixed(2)}h</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
