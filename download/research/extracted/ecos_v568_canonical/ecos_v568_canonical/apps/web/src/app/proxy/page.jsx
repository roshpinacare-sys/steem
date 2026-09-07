'use client';

import { useEffect, useState } from 'react';

const EXPRESS_BASE = process.env.NEXT_PUBLIC_EXPRESS_BASE || 'http://localhost:3000';

export default function ProxyPage() {
  const [config, setConfig] = useState(null);
  const [stats, setStats] = useState(null);
  const [sample, setSample] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    try {
      const [cfgRes, statsRes] = await Promise.all([
        fetch(`${EXPRESS_BASE}/api/v1/proxy/config`),
        fetch(`${EXPRESS_BASE}/api/v1/proxy/stats`),
      ]);
      setConfig(await cfgRes.json());
      setStats(await statsRes.json());
    } catch (err) {
      setConfig({ ok: false, error: err.message });
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  async function runDemo() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${EXPRESS_BASE}/api/v1/proxy/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userPrompt: sample || 'Summarize ECOS V114 compliance proxy in one sentence.',
          clientAccountId: 'client::compliance_proxy_demo',
          priceUsd: '0.01',
          taskType: 'proxy-demo',
          metadata: { source: 'web-proxy-page' },
        }),
      });
      setResult(await res.json());
      await load();
    } catch (err) {
      setResult({ ok: false, error: err.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <section style={S.page}>
      <div style={S.hero}>
        <p style={S.kicker}>ECOS V114</p>
        <h1 style={S.title}>Compliance Proxy</h1>
        <p style={S.subtitle}>
          Route external AI calls through confidence gating, HITL escalation, and append-only PROXY_CALL audit entries.
        </p>
      </div>

      <div style={S.grid}>
        <Card title="Policy">
          <pre style={S.pre}>{JSON.stringify(config?.policy || config, null, 2)}</pre>
        </Card>
        <Card title="Live Stats">
          <pre style={S.pre}>{JSON.stringify(stats || { loading: true }, null, 2)}</pre>
        </Card>
      </div>

      <Card title="Try the proxy">
        <textarea
          style={S.textarea}
          value={sample}
          onChange={e => setSample(e.target.value)}
          placeholder="Enter a prompt to route through /api/v1/proxy/complete"
        />
        <button style={S.button} onClick={runDemo} disabled={loading}>{loading ? 'Running…' : 'Run compliant completion'}</button>
        {result && <pre style={S.pre}>{JSON.stringify(result, null, 2)}</pre>}
      </Card>
    </section>
  );
}

function Card({ title, children }) {
  return <div style={S.card}><h2 style={S.cardTitle}>{title}</h2>{children}</div>;
}

const S = {
  page: { minHeight: '100%', overflow: 'auto', padding: '48px', color: '#f8fafc', background: 'linear-gradient(135deg, #020617 0%, #111827 60%, #281047 100%)' },
  hero: { maxWidth: 900, marginBottom: 32 },
  kicker: { color: '#a78bfa', letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 700 },
  title: { fontSize: 54, lineHeight: 1, margin: '8px 0 16px' },
  subtitle: { fontSize: 18, color: '#cbd5e1', maxWidth: 760 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, marginBottom: 20 },
  card: { background: 'rgba(15, 23, 42, 0.78)', border: '1px solid rgba(167,139,250,0.30)', borderRadius: 20, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.30)' },
  cardTitle: { marginTop: 0, color: '#ddd6fe' },
  pre: { whiteSpace: 'pre-wrap', background: '#020617', border: '1px solid #334155', borderRadius: 14, padding: 16, color: '#dbeafe', overflowX: 'auto' },
  textarea: { width: '100%', minHeight: 120, borderRadius: 14, border: '1px solid #475569', padding: 16, background: '#020617', color: '#f8fafc', marginBottom: 12 },
  button: { border: 0, borderRadius: 999, padding: '12px 18px', background: '#8b5cf6', color: 'white', fontWeight: 700, cursor: 'pointer', marginBottom: 16 },
};
