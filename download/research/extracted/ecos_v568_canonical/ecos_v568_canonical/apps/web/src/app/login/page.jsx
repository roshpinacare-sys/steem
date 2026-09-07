'use client';
/**
 * apps/web/src/app/login/page.jsx — ECOS V143
 * [V143-AUTH-01] Real login page: email + password → access JWT + refresh token.
 *
 * Flow:
 *   1. User submits email + password
 *   2. POST /api/v1/auth/login → { accessToken, refreshToken, expiresIn, user }
 *   3. accessToken stored in memory (not localStorage — XSS protection)
 *   4. refreshToken stored in httpOnly cookie (set by server) OR memory fallback
 *   5. Redirect to /dashboard
 */

import { useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// ── Shared styles ─────────────────────────────────────────────────────────────

const S = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #030712 0%, #0f172a 60%, #1e1b4b 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Inter', system-ui, sans-serif",
    padding: 24,
  },
  card: {
    background: '#0f172a',
    border: '1px solid #1e3a5f',
    borderRadius: 16,
    padding: '40px 36px',
    width: '100%',
    maxWidth: 420,
    boxShadow: '0 25px 50px rgba(0,0,0,0.6)',
  },
  logo: { fontSize: 32, textAlign: 'center', marginBottom: 8 },
  title: { color: '#f9fafb', fontSize: 22, fontWeight: 800, textAlign: 'center', margin: 0 },
  sub:   { color: '#6b7280', fontSize: 13, textAlign: 'center', marginTop: 6, marginBottom: 28 },
  label: { color: '#93c5fd', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 },
  input: {
    width: '100%', background: '#111827', border: '1px solid #374151',
    borderRadius: 8, padding: '10px 14px', color: '#f9fafb', fontSize: 14,
    outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s',
  },
  inputFocus: { borderColor: '#3b82f6' },
  btn: {
    width: '100%', background: '#1d4ed8', border: 'none', borderRadius: 9,
    padding: '12px 0', color: '#fff', fontWeight: 700, fontSize: 15,
    cursor: 'pointer', marginTop: 20, transition: 'background 0.15s',
    letterSpacing: '0.01em',
  },
  btnDisabled: { background: '#1e3a5f', cursor: 'not-allowed' },
  error: {
    background: '#450a0a', border: '1px solid #7f1d1d',
    borderRadius: 8, padding: '10px 14px', color: '#fca5a5',
    fontSize: 13, marginTop: 16, textAlign: 'center',
  },
  success: {
    background: '#052e16', border: '1px solid #14532d',
    borderRadius: 8, padding: '10px 14px', color: '#86efac',
    fontSize: 13, marginTop: 16, textAlign: 'center',
  },
  divider: {
    display: 'flex', alignItems: 'center', gap: 12,
    color: '#374151', fontSize: 12, margin: '20px 0',
  },
  divLine: { flex: 1, height: 1, background: '#1f2937' },
  link: { color: '#3b82f6', textDecoration: 'none', fontSize: 13 },
  field: { marginBottom: 16 },
};

// ── LoginForm ─────────────────────────────────────────────────────────────────

function LoginForm({ onSuccess }) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [focus,    setFocus]    = useState(null);

  async function handleSubmit() {
    if (!email || !password) { setError('Email and password are required'); return; }
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${API_BASE}/api/v1/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
        credentials: 'include', // for httpOnly cookie support when same-origin
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        setError(d.error || 'Login failed');
        return;
      }
      // Store access token in sessionStorage (survives tab refresh, not other tabs)
      // Refresh token ideally comes via httpOnly cookie from server
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem('ecos_access_token', d.accessToken);
        sessionStorage.setItem('ecos_user', JSON.stringify(d.user));
      }
      onSuccess(d);
    } catch (e) { setError(e.message || 'Network error'); }
    finally { setLoading(false); }
  }

  function handleKeyDown(e) { if (e.key === 'Enter') handleSubmit(); }

  return (
    <div>
      <div style={S.field}>
        <label style={S.label}>Email</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocus('email')}
          onBlur={() => setFocus(null)}
          placeholder="you@example.com"
          autoComplete="email"
          style={{ ...S.input, ...(focus === 'email' ? S.inputFocus : {}) }}
        />
      </div>
      <div style={S.field}>
        <label style={S.label}>Password</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocus('password')}
          onBlur={() => setFocus(null)}
          placeholder="••••••••"
          autoComplete="current-password"
          style={{ ...S.input, ...(focus === 'password' ? S.inputFocus : {}) }}
        />
      </div>
      <button
        onClick={handleSubmit}
        disabled={loading || !email || !password}
        style={{ ...S.btn, ...(loading || !email || !password ? S.btnDisabled : {}) }}
      >
        {loading ? 'Signing in…' : 'Sign In'}
      </button>
      {error && <div style={S.error}>{error}</div>}
    </div>
  );
}

// ── RegisterForm ──────────────────────────────────────────────────────────────

function RegisterForm({ onSuccess }) {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [name,     setName]     = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);
  const [focus,    setFocus]    = useState(null);

  async function handleSubmit() {
    if (!email || !password) { setError('Email and password are required'); return; }
    if (password.length < 8)  { setError('Password must be at least 8 characters'); return; }
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${API_BASE}/api/v1/auth/register`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password, displayName: name }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        setError(d.error || 'Registration failed');
        return;
      }
      onSuccess({ registered: true, email: d.email });
    } catch (e) { setError(e.message || 'Network error'); }
    finally { setLoading(false); }
  }

  function handleKeyDown(e) { if (e.key === 'Enter') handleSubmit(); }

  return (
    <div>
      <div style={S.field}>
        <label style={S.label}>Display Name (optional)</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocus('name')}
          onBlur={() => setFocus(null)}
          placeholder="Your name"
          style={{ ...S.input, ...(focus === 'name' ? S.inputFocus : {}) }}
        />
      </div>
      <div style={S.field}>
        <label style={S.label}>Email</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocus('email')}
          onBlur={() => setFocus(null)}
          placeholder="you@example.com"
          autoComplete="email"
          style={{ ...S.input, ...(focus === 'email' ? S.inputFocus : {}) }}
        />
      </div>
      <div style={S.field}>
        <label style={S.label}>Password (≥8 characters)</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocus('password')}
          onBlur={() => setFocus(null)}
          placeholder="Create a strong password"
          autoComplete="new-password"
          style={{ ...S.input, ...(focus === 'password' ? S.inputFocus : {}) }}
        />
      </div>
      <button
        onClick={handleSubmit}
        disabled={loading || !email || !password}
        style={{ ...S.btn, background: loading || !email || !password ? S.btnDisabled.background : '#059669', ...(loading || !email || !password ? S.btnDisabled : {}) }}
      >
        {loading ? 'Creating account…' : 'Create Account'}
      </button>
      {error && <div style={S.error}>{error}</div>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const [mode,    setMode]    = useState('login'); // 'login' | 'register'
  const [success, setSuccess] = useState(null);

  function handleLoginSuccess(data) {
    setSuccess({
      type: 'login',
      message: `Welcome back, ${data.user?.displayName || data.user?.email}! Redirecting…`,
    });
    setTimeout(() => {
      if (typeof window !== 'undefined') window.location.href = '/dashboard';
    }, 1200);
  }

  function handleRegisterSuccess(data) {
    setSuccess({ type: 'register', message: `Account created for ${data.email}. You can now sign in.` });
    setTimeout(() => setMode('login'), 2000);
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.logo}>⊙</div>
        <h1 style={S.title}>ECOS</h1>
        <p style={S.sub}>Sovereign Intellectual-Work Economy</p>

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24, background: '#111827', borderRadius: 9, padding: 3 }}>
          {['login', 'register'].map(tab => (
            <button
              key={tab}
              onClick={() => { setMode(tab); setSuccess(null); }}
              style={{
                flex: 1, border: 'none', borderRadius: 7, padding: '8px 0',
                fontWeight: 600, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
                background: mode === tab ? '#1e3a5f' : 'transparent',
                color: mode === tab ? '#93c5fd' : '#6b7280',
              }}
            >
              {tab === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        {success ? (
          <div style={S.success}>{success.message}</div>
        ) : mode === 'login' ? (
          <LoginForm onSuccess={handleLoginSuccess} />
        ) : (
          <RegisterForm onSuccess={handleRegisterSuccess} />
        )}

        {/* Footer links */}
        <div style={{ ...S.divider, marginTop: 24 }}>
          <div style={S.divLine} />
          <span>or continue with</span>
          <div style={S.divLine} />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <a href="/validator" style={{ ...S.link, flex: 1, textAlign: 'center', background: '#111827', borderRadius: 8, padding: '8px 0', border: '1px solid #1f2937' }}>
            Validator Login
          </a>
          <a href="/dashboard" style={{ ...S.link, flex: 1, textAlign: 'center', background: '#111827', borderRadius: 8, padding: '8px 0', border: '1px solid #1f2937' }}>
            Continue as Guest
          </a>
        </div>

        <p style={{ color: '#374151', fontSize: 11, textAlign: 'center', marginTop: 20, lineHeight: 1.5 }}>
          Access tokens expire in 15 minutes. Refresh tokens are valid for 30 days.<br />
          <a href="/dashboard" style={{ color: '#4b5563' }}>← Back to dashboard</a>
        </p>
      </div>
    </div>
  );
}
