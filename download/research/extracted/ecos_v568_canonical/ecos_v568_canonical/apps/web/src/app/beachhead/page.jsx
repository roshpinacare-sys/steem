'use client';

  export default function BeachheadPage() {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', fontFamily: 'system-ui, sans-serif' }}>

        {/* Hero */}
        <div style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%)', padding: '4rem 2rem 3rem', textAlign: 'center' }}>
          <div style={{ display: 'inline-block', background: '#1d4ed8', color: '#bfdbfe', borderRadius: 20, padding: '0.3rem 0.9rem', fontSize: '0.8rem', fontWeight: 600, marginBottom: '1.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            EU AI Act Art.12/14 Compliant · August 2, 2026
          </div>
          <h1 style={{ color: '#f8fafc', fontSize: 'clamp(1.75rem, 4vw, 2.75rem)', fontWeight: 800, maxWidth: 700, margin: '0 auto 1rem', lineHeight: 1.2 }}>
            The First AI Validation Layer<br/>Built for the EU AI Act Deadline
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '1.1rem', maxWidth: 560, margin: '0 auto 2rem', lineHeight: 1.6 }}>
            ECOS delivers SHA-256 audit chains, human oversight for every high-stakes AI decision, and graduated validator pay — all compliant before August 2.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="mailto:partners@ecos.ai" style={{ padding: '0.85rem 2rem', background: '#2563eb', color: '#fff', borderRadius: 10, fontWeight: 700, textDecoration: 'none', fontSize: '1rem' }}>
              Book a Design Partner Call
            </a>
            <a href="/validator" style={{ padding: '0.85rem 2rem', background: 'transparent', color: '#93c5fd', border: '1.5px solid #3b82f6', borderRadius: 10, fontWeight: 600, textDecoration: 'none', fontSize: '1rem' }}>
              See the Stack
            </a>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ background: '#1e293b', padding: '2rem', borderTop: '1px solid #334155', borderBottom: '1px solid #334155' }}>
          <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '2rem', textAlign: 'center' }}>
            {[
              { value: '$2B+', label: 'EvenUp precedent (legal AI)', color: '#3b82f6' },
              { value: '$11B', label: 'Harvey valuation (legal AI)', color: '#8b5cf6' },
              { value: '64 days', label: 'Until EU AI Act deadline', color: '#f59e0b' },
              { value: '~780+', label: 'Test cases passing', color: '#10b981' },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Target Verticals */}
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '3rem 2rem' }}>
          <h2 style={{ color: '#f8fafc', fontSize: '1.5rem', fontWeight: 700, textAlign: 'center', marginBottom: '2rem' }}>Target Beachhead Verticals</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>

            {/* Insurance Claims */}
            <div style={{ background: '#1e293b', borderRadius: 16, padding: '2rem', border: '1.5px solid #0ea5e9' }}>
              <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>🏛️</div>
              <h3 style={{ color: '#f8fafc', fontWeight: 700, fontSize: '1.15rem', marginBottom: '0.75rem' }}>Insurance Claims Adjustment</h3>
              <p style={{ color: '#94a3b8', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1.25rem' }}>
                AI-assisted claims review requires human oversight under EU AI Act Art.14. ECOS provides the compliant HITL layer — ThreeWayRouter directs complex claims to senior adjusters, simple claims auto-flow.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {['SHA-256 court-admissible audit chain', '$18-50/hr beginner adjusters', '$50-95/hr senior specialists', 'ISO 20022 payout rails ready'].map(f => (
                  <div key={f} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.85rem', color: '#bae6fd' }}>
                    <span style={{ color: '#0ea5e9', flexShrink: 0 }}>✓</span> {f}
                  </div>
                ))}
              </div>
            </div>

            {/* Legal Document Review */}
            <div style={{ background: '#1e293b', borderRadius: 16, padding: '2rem', border: '1.5px solid #a78bfa' }}>
              <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⚖️</div>
              <h3 style={{ color: '#f8fafc', fontWeight: 700, fontSize: '1.15rem', marginBottom: '0.75rem' }}>Legal Document Review</h3>
              <p style={{ color: '#94a3b8', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1.25rem' }}>
                Legal AI tools (Harvey, Casetext) need validated human review for high-stakes documents. ECOS provides the compliant validation middleware with full provenance and replay capability.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {['Deterministic replay engine (full audit trail)', 'Golden task QC for legal validators', 'Sybil-resistant validator onboarding', 'NIST AI RMF 1.0 self-assessment ready'].map(f => (
                  <div key={f} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.85rem', color: '#ede9fe' }}>
                    <span style={{ color: '#a78bfa', flexShrink: 0 }}>✓</span> {f}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Compliance Stack */}
        <div style={{ background: '#1e293b', padding: '3rem 2rem' }}>
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            <h2 style={{ color: '#f8fafc', fontSize: '1.5rem', fontWeight: 700, textAlign: 'center', marginBottom: '2rem' }}>The Compliance Stack</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
              {[
                { icon: '🔗', title: 'SHA-256 Audit Chain', desc: 'Every decision immutably hashed. Court-admissible evidence under EU AI Act Art.12.' },
                { icon: '🧠', title: 'ThreeWayRouter', desc: 'AUTO for simple tasks, BEGINNER for standard, SENIOR for high-stakes. Confidence-gated.' },
                { icon: '🎓', title: 'Graduation Ladder', desc: 'USE → VERIFY → OWN → RECRUIT → MENTOR. Reward quality, not just quantity.' },
                { icon: '🛡️', title: 'Sybil Resistance', desc: 'IP velocity, email alias, device fingerprint scoring. BLOCK/REVIEW/ALLOW verdicts.' },
                { icon: '✅', title: 'Golden Task QC', desc: '~8% of validator slots are known-answer quality checks. 80% accuracy required.' },
                { icon: '📋', title: 'NIST AI RMF', desc: 'GOVERN, MAP, MEASURE, MANAGE — 16 categories, live self-assessment endpoint.' },
              ].map(item => (
                <div key={item.title} style={{ background: '#0f172a', borderRadius: 12, padding: '1.5rem', border: '1px solid #334155' }}>
                  <div style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>{item.icon}</div>
                  <div style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.5rem' }}>{item.title}</div>
                  <div style={{ color: '#64748b', fontSize: '0.82rem', lineHeight: 1.5 }}>{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Pricing */}
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '3rem 2rem' }}>
          <h2 style={{ color: '#f8fafc', fontSize: '1.5rem', fontWeight: 700, textAlign: 'center', marginBottom: '2rem' }}>Design Partner Pricing</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            {[
              { name: 'Starter Pilot', price: '$500/mo', color: '#3b82f6', features: ['Up to 500 tasks/month', 'Full audit chain + replay', 'Beginner validator pool', 'Email support', '60-day pilot commitment'] },
              { name: 'Growth Pilot', price: '$2,000/mo', color: '#8b5cf6', features: ['Up to 5,000 tasks/month', 'ThreeWayRouter (all 3 queues)', 'Senior validator access', 'Stablecoin payout rails', 'Dedicated Slack channel', 'EU AI Act compliance report'] },
            ].map(plan => (
              <div key={plan.name} style={{ background: '#1e293b', borderRadius: 16, padding: '2rem', border: `1.5px solid ${plan.color}` }}>
                <h3 style={{ color: '#f8fafc', fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.25rem' }}>{plan.name}</h3>
                <div style={{ fontSize: '2rem', fontWeight: 800, color: plan.color, marginBottom: '1.25rem' }}>{plan.price}</div>
                {plan.features.map(f => (
                  <div key={f} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.87rem', color: '#94a3b8', marginBottom: '0.5rem' }}>
                    <span style={{ color: plan.color }}>✓</span> {f}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: '2rem' }}>
            <a href="mailto:partners@ecos.ai" style={{ display: 'inline-block', padding: '1rem 3rem', background: '#2563eb', color: '#fff', borderRadius: 12, fontWeight: 700, fontSize: '1.05rem', textDecoration: 'none' }}>
              Book a 30-min Design Partner Call →
            </a>
            <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: '1rem' }}>3-5 design partners only · Shipping before August 2, 2026 EU AI Act deadline</p>
          </div>
        </div>
      </div>
    );
  }
  