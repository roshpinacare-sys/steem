import React from 'react';

export const metadata = {
  title: 'Get paid to make AI trustworthy',
  description: '$0.25 per task. 60 seconds each. No experience needed.',
  openGraph: {
    title: 'Get paid to make AI trustworthy',
    description: '$0.25 per task. 60 seconds each. No experience needed.',
  },
};

export default function HomePage() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100%',
      padding: '40px 24px',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
      color: '#f3f4f6',
      textAlign: 'center',
      overflowY: 'auto',
    }}>
      <div style={{ maxWidth: 640, width: '100%' }}>
        <h1 style={{
          fontSize: '2.5rem',
          fontWeight: 900,
          color: '#ffffff',
          marginBottom: '16px',
          letterSpacing: '-0.025em',
          lineHeight: '1.2'
        }}>
          Get paid to make AI trustworthy
        </h1>
        
        <p style={{
          fontSize: '1.25rem',
          color: '#cbd5e1',
          marginBottom: '32px',
          fontWeight: 500
        }}>
          $0.25 per task. 60 seconds each. No experience needed.
        </p>

        <div style={{
          background: 'rgba(30, 41, 59, 0.5)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 16,
          padding: '24px',
          marginBottom: '40px',
          textAlign: 'left',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)'
        }}>
          <ul style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <li style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: 'rgba(59, 130, 246, 0.2)',
                color: '#3b82f6',
                fontWeight: 'bold',
                fontSize: '14px'
              }}>✓</span>
              <span style={{ fontSize: '1.1rem', color: '#e2e8f0', fontWeight: 500 }}>Review AI decisions</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: 'rgba(168, 85, 247, 0.2)',
                color: '#a855f7',
                fontWeight: 'bold',
                fontSize: '14px'
              }}>✓</span>
              <span style={{ fontSize: '1.1rem', color: '#e2e8f0', fontWeight: 500 }}>Earn credits for accurate validation</span>
            </li>
            <li style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: 'rgba(16, 185, 129, 0.2)',
                color: '#10b981',
                fontWeight: 'bold',
                fontSize: '14px'
              }}>✓</span>
              <span style={{ fontSize: '1.1rem', color: '#e2e8f0', fontWeight: 500 }}>Help keep automated systems safe</span>
            </li>
          </ul>
        </div>

        <a href="/onboarding" style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#7c3aed',
          color: '#ffffff',
          fontWeight: '700',
          fontSize: '1.2rem',
          padding: '16px 40px',
          borderRadius: '9999px',
          border: 'none',
          textDecoration: 'none',
          boxShadow: '0 4px 14px 0 rgba(124, 58, 237, 0.4)',
          transition: 'transform 0.2s, background-color 0.2s',
          cursor: 'pointer',
          fontFamily: 'inherit'
        }}>
          Start earning →
        </a>
      </div>
    </div>
  );
}
