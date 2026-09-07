/**
 * ECOS App Layout — V36
 * ─────────────────────────────────────────────────────────────────────────────
 * Root layout for Next.js App Router.
 * Top nav: "ECOS" logo left, "Chat" + "Validator" links right.
 * Clean, minimal. Inline styles only — no external UI libraries.
 */

import { Inter } from 'next/font/google';
import NotificationNavItem from '../components/NotificationNavItem';

// Gracefully handle missing next/font/google in older Next.js builds
let fontClass = '';
let fontStyle = {};
try {
  // next/font is available in Next.js 13+
} catch (_) {}

export const metadata = {
  title:       'ECOS — Proof of Intellectual Work | V154',
  description: 'ECOS B2B protocol: AI task processing, HITL validation, royalty distribution.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          html, body { height: 100%; }
          body {
            background: #111827;
            color: #e5e7eb;
            font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
            -webkit-font-smoothing: antialiased;
          }
          a { color: inherit; text-decoration: none; }
          a:hover { text-decoration: underline; }
          .ecos-nav-link:hover {
            color: #e5e7eb !important;
            background: #1f2937 !important;
            text-decoration: none;
          }
          ::-webkit-scrollbar { width: 6px; height: 6px; }
          ::-webkit-scrollbar-track { background: #1f2937; }
          ::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
          ::-webkit-scrollbar-thumb:hover { background: #4b5563; }
        `}</style>
      </head>
      <body>
        {/* ── Top Navigation ─────────────────────────────────────────────── */}
        <nav style={navStyle}>
          {/* Logo */}
          <a href="/chat" style={logoStyle}>
            <span style={logoDotStyle}>●</span>
            <span>ECOS</span>
          </a>

          {/* Nav links */}
          <div style={linksStyle}>
            <NavLink href="/chat"        label="Chat"        />
            <NavLink href="/dashboard"   label="Dashboard"   />
            <NavLink href="/chain"       label="Chain"       />
            <NavLink href="/leaderboard" label="Leaderboard" />
            <NavLink href="/strategy"    label="Strategy"    />
            <NavLink href="/validator"   label="Validator"   />
            <NavLink href="/royalties"   label="Royalties"   />
            <NavLink href="/proxy"       label="Proxy"       />
            <NavLink href="/wallet"     label="Wallet"      />
            <NavLink href="/me"         label="Me"          />
            <NavLink href="/language"   label="🌐 Language"  />
            <NavLink href="/sovereign"  label="⛓️ Sovereign"  />
            <NavLink href="/rank"       label="🏆 Rank"        />
            <NavLink href="/comm"          label="📡 Channels"    />
            <NotificationNavItem />
            <NavLink href="/login"         label="🔑 Login"       />
            <NavLink href="/admin"         label="Admin"       />
            <NavLink href="/reports"       label="📄 Reports"  />
          </div>
        </nav>

        {/* ── Page content ───────────────────────────────────────────────── */}
        <main style={{ height: 'calc(100vh - 56px)', overflow: 'hidden' }}>
          {children}
        </main>
      </body>
    </html>
  );
}

// ── NavLink component ─────────────────────────────────────────────────────────
function NavLink({ href, label }) {
  return (
    <a
      href={href}
      className="ecos-nav-link"
      style={navLinkStyle}
    >
      {label}
    </a>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const navStyle = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  height:         56,
  padding:        '0 24px',
  background:     '#0f172a',
  borderBottom:   '1px solid #1f2937',
  position:       'sticky',
  top:            0,
  zIndex:         100,
};

const logoStyle = {
  display:        'flex',
  alignItems:     'center',
  gap:            8,
  fontWeight:     800,
  fontSize:       18,
  letterSpacing:  '0.08em',
  color:          '#e5e7eb',
  textDecoration: 'none',
};

const logoDotStyle = {
  color:     '#3b82f6',
  fontSize:  14,
  lineHeight: 1,
};

const linksStyle = {
  display:    'flex',
  alignItems: 'center',
  gap:        4,
};

const navLinkStyle = {
  color:        '#9ca3af',
  fontSize:     14,
  fontWeight:   500,
  padding:      '6px 14px',
  borderRadius: 6,
  transition:   'color 0.15s, background 0.15s',
  background:   'transparent',
};
