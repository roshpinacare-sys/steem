/**
 * ECOS Protocol Economics — Strategy Page (V100)
 * ─────────────────────────────────────────────────────────────────────────────
 * Route: /strategy
 *
 * Sections:
 *   1. Live Economics Dashboard  — fetches /api/v1/stats + /api/v1/validators/leaderboard
 *   2. The 40/40/20 Model        — interactive stacked bar + per-$1 toggle
 *   3. Validator Opportunity     — earnings calculator (tasks/day × price sliders)
 *   4. Top Validators Today      — leaderboard table (top 5)
 */

'use client';

import { useState, useEffect, useCallback } from 'react';

// ── helpers ────────────────────────────────────────────────────────────────────
function usd(n) {
  if (n == null) return '$0.00';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  return '$' + (isNaN(num) ? '0.00' : num.toFixed(2));
}

function pct(a, b) {
  const total = (a || 0) + (b || 0);
  if (!total) return '0%';
  return ((a / total) * 100).toFixed(1) + '%';
}

// ── styles ─────────────────────────────────────────────────────────────────────
const S = {
  page: {
    fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
    background: '#0f172a',
    color: '#e2e8f0',
    minHeight: '100vh',
    overflowY: 'auto',
  },
  hero: {
    borderBottom: '1px solid #1e293b',
    padding: '48px 40px 36px',
    maxWidth: 1100,
    margin: '0 auto',
  },
  badge: {
    display: 'inline-block',
    background: '#1e1b4b',
    border: '1px solid #4f46e5',
    color: '#a5b4fc',
    borderRadius: 20,
    padding: '4px 14px',
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
  h1: {
    fontSize: 36,
    fontWeight: 800,
    color: '#f1f5f9',
    margin: 0,
    lineHeight: 1.2,
  },
  subtitle: {
    fontSize: 16,
    color: '#94a3b8',
    marginTop: 10,
    maxWidth: 600,
  },
  section: {
    maxWidth: 1100,
    margin: '0 auto',
    padding: '40px 40px 0',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: '#f1f5f9',
    marginBottom: 4,
  },
  sectionSub: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 24,
  },
  card: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 12,
    padding: '20px 24px',
  },
  statCard: {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 10,
    padding: '18px 20px',
    flex: '1 1 180px',
  },
  statLabel: { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  statValue: { fontSize: 26, fontWeight: 700, color: '#f1f5f9' },
  statSub:   { fontSize: 12, color: '#475569', marginTop: 4 },
  grid4: { display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 32 },
  divider: { borderColor: '#1e293b', margin: '36px 0 0', borderStyle: 'solid', borderWidth: '1px 0 0' },
};

// ── component ──────────────────────────────────────────────────────────────────
export default function StrategyPage() {
  const [stats,       setStats]       = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [perOne,      setPerOne]      = useState(false);   // toggle for stacked bar
  const [tasksDay,    setTasksDay]    = useState(20);
  const [taskPrice,   setTaskPrice]   = useState(2.00);

  // ── fetch data ───────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [sRes, lRes] = await Promise.all([
        fetch('/api/v1/stats'),
        fetch('/api/v1/validators/leaderboard?limit=5'),
      ]);
      if (sRes.ok)  setStats(await sRes.json());
      if (lRes.ok)  setLeaderboard((await lRes.json()).validators || []);
    } catch (_) { /* degrade gracefully */ }
    finally     { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // ── derived economics ────────────────────────────────────────────────────────
  const ledger     = stats?.ledger || {};
  const platBal    = parseFloat(ledger.platformBalance  || '0') || 0;
  const insBal     = parseFloat(ledger.insuranceBalance || '0') || 0;
  const autoFlow   = stats?.autoFlow   || 0;
  const hitlQueue  = stats?.hitlQueue  || stats?.approvals?.pending || 0;
  const autoRate   = pct(autoFlow, autoFlow + hitlQueue);
  const calObj     = stats?.calibrator || {};

  // leaderboard validator payouts (sum)
  const totalValidatorEarned = leaderboard.reduce((sum, v) => {
    const e = parseFloat(String(v.totalEarned || '0').replace('$', '')) || 0;
    return sum + e;
  }, 0);

  // earnings calculator
  const dailyEarnings   = tasksDay * taskPrice * 0.40;
  const monthlyEarnings = dailyEarnings * 30;
  const annualEarnings  = dailyEarnings * 365;

  // 40/40/20 bar values
  const barData = perOne
    ? [
        { label: 'Platform',  value: 0.40, color: '#6366f1', display: '$0.40' },
        { label: 'Validator', value: 0.40, color: '#22c55e', display: '$0.40' },
        { label: 'Insurance', value: 0.20, color: '#f59e0b', display: '$0.20' },
      ]
    : [
        { label: 'Platform',  value: 40, color: '#6366f1', display: '40%' },
        { label: 'Validator', value: 40, color: '#22c55e', display: '40%' },
        { label: 'Insurance', value: 20, color: '#f59e0b', display: '20%' },
      ];

  return (
    <div style={S.page}>
      {/* ── Hero ── */}
      <div style={S.hero}>
        <div style={S.badge}>Protocol Economics</div>
        <h1 style={S.h1}>How ECOS creates sustainable value for all participants</h1>
        <p style={S.subtitle}>
          Every task processed by ECOS generates transparent, on-chain revenue
          split across platform, validators, and an insurance pool — automatically.
        </p>
      </div>

      {/* ── SECTION 1: Live Economics Dashboard ── */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Live Economics Dashboard</div>
        <div style={S.sectionSub}>Real-time protocol financials</div>

        {loading ? (
          <div style={{ color: '#475569', fontSize: 14, padding: '20px 0' }}>Loading…</div>
        ) : (
          <div style={S.grid4}>
            <div style={S.statCard}>
              <div style={S.statLabel}>Platform Balance</div>
              <div style={S.statValue}>{usd(ledger.platformBalance)}</div>
              <div style={S.statSub}>40% of each task</div>
            </div>
            <div style={S.statCard}>
              <div style={S.statLabel}>Validator Payouts</div>
              <div style={{ ...S.statValue, color: '#22c55e' }}>{usd(totalValidatorEarned)}</div>
              <div style={S.statSub}>Sum across top validators</div>
            </div>
            <div style={S.statCard}>
              <div style={S.statLabel}>Insurance Pool</div>
              <div style={{ ...S.statValue, color: '#f59e0b' }}>{usd(ledger.insuranceBalance)}</div>
              <div style={S.statSub}>20% of each task</div>
            </div>
            <div style={S.statCard}>
              <div style={S.statLabel}>Auto-Flow Rate</div>
              <div style={{ ...S.statValue, color: '#a5b4fc' }}>{autoRate}</div>
              <div style={S.statSub}>{autoFlow} auto / {hitlQueue} HITL</div>
            </div>
            <div style={S.statCard}>
              <div style={S.statLabel}>Calibrator</div>
              <div style={{ ...S.statValue, fontSize: 18, color: calObj.ready ? '#22c55e' : '#f59e0b' }}>
                {calObj.ready ? '✓ Ready' : '⚠ Not Ready'}
              </div>
              <div style={S.statSub}>
                {calObj.sampleCount || 0} samples
                {calObj.params ? ` · A=${(calObj.params.A || 0).toFixed(2)}  B=${(calObj.params.B || 0).toFixed(2)}` : ''}
              </div>
            </div>
          </div>
        )}
        <hr style={S.divider} />
      </div>

      {/* ── SECTION 2: 40/40/20 Model ── */}
      <div style={S.section}>
        <div style={S.sectionTitle}>The 40/40/20 Model</div>
        <div style={{ ...S.sectionSub, display: 'flex', alignItems: 'center', gap: 12 }}>
          Transparent revenue split on every task
          <button
            onClick={() => setPerOne(p => !p)}
            style={{
              background: perOne ? '#1e40af' : '#1e293b',
              border: '1px solid #334155', borderRadius: 6,
              color: perOne ? '#bfdbfe' : '#94a3b8',
              cursor: 'pointer', fontSize: 11, padding: '4px 12px',
              letterSpacing: 1, textTransform: 'uppercase',
            }}
          >
            {perOne ? 'Per $1 task' : 'Show %'}
          </button>
        </div>

        <div style={S.card}>
          {/* Stacked bar */}
          <div style={{ display: 'flex', height: 48, borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
            {barData.map(seg => (
              <div
                key={seg.label}
                style={{
                  flex: seg.value,
                  background: seg.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#fff',
                  transition: 'flex 0.4s ease',
                }}
              >
                {seg.display}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {[
              { color: '#6366f1', label: 'Platform (40%)',  desc: 'Infrastructure, AI compute, operations' },
              { color: '#22c55e', label: 'Validator (40%)', desc: 'Human reviewer earning recurring income' },
              { color: '#f59e0b', label: 'Insurance (20%)', desc: 'Dispute resolution and quality assurance' },
            ].map(item => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: '1 1 200px' }}>
                <div style={{
                  width: 12, height: 12, borderRadius: 3,
                  background: item.color, marginTop: 3, flexShrink: 0,
                }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>{item.label}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <hr style={S.divider} />
      </div>

      {/* ── SECTION 3: Validator Opportunity Calculator ── */}
      <div style={S.section}>
        <div style={S.sectionTitle}>Validator Opportunity</div>
        <div style={S.sectionSub}>How much can a validator earn?</div>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {/* Sliders */}
          <div style={{ ...S.card, flex: '1 1 300px' }}>
            <div style={{ marginBottom: 28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <label style={{ fontSize: 13, color: '#94a3b8' }}>Tasks per day</label>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#a5b4fc' }}>{tasksDay}</span>
              </div>
              <input
                type="range" min={1} max={100} value={tasksDay}
                onChange={e => setTasksDay(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#6366f1' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#475569', marginTop: 4 }}>
                <span>1</span><span>100</span>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <label style={{ fontSize: 13, color: '#94a3b8' }}>Avg task price</label>
                <span style={{ fontSize: 15, fontWeight: 700, color: '#22c55e' }}>{usd(taskPrice)}</span>
              </div>
              <input
                type="range" min={0.5} max={10} step={0.5} value={taskPrice}
                onChange={e => setTaskPrice(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#22c55e' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#475569', marginTop: 4 }}>
                <span>$0.50</span><span>$10.00</span>
              </div>
            </div>
          </div>

          {/* Results */}
          <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { label: 'Daily earnings',   value: usd(dailyEarnings),   color: '#a5b4fc' },
              { label: 'Monthly earnings', value: usd(monthlyEarnings), color: '#22c55e' },
              { label: 'Annual earnings',  value: usd(annualEarnings),  color: '#f59e0b' },
            ].map(item => (
              <div key={item.label} style={{ ...S.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#94a3b8' }}>{item.label}</span>
                <span style={{ fontSize: 22, fontWeight: 800, color: item.color }}>{item.value}</span>
              </div>
            ))}
            <div style={{
              padding: '12px 16px',
              background: '#0f172a',
              border: '1px solid #22c55e30',
              borderRadius: 8,
              fontSize: 12,
              color: '#4ade80',
            }}>
              At {tasksDay} tasks/day at {usd(taskPrice)}/task → {usd(annualEarnings)}/year
            </div>
          </div>
        </div>
        <hr style={S.divider} />
      </div>

      {/* ── SECTION 4: Top Validators Today ── */}
      <div style={{ ...S.section, paddingBottom: 48 }}>
        <div style={S.sectionTitle}>Top Validators Today</div>
        <div style={S.sectionSub}>Leaderboard (top 5 by reputation score)</div>

        <div style={S.card}>
          {leaderboard.length === 0 ? (
            <div style={{ color: '#475569', fontSize: 13 }}>
              {loading ? 'Loading…' : 'No validators registered yet.'}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Rank', 'Validator ID', 'Score', 'Tasks', 'Earned'].map(h => (
                    <th key={h} style={{
                      textAlign: h === 'Rank' ? 'center' : 'left',
                      padding: '8px 12px',
                      fontSize: 11,
                      color: '#475569',
                      textTransform: 'uppercase',
                      letterSpacing: 1,
                      borderBottom: '1px solid #334155',
                      fontWeight: 500,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((v, i) => {
                  const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${v.rank || i + 1}`;
                  return (
                    <tr key={v.validatorId} style={{ borderBottom: '1px solid #1e293b' }}>
                      <td style={{ textAlign: 'center', padding: '12px', fontSize: 16 }}>{medal}</td>
                      <td style={{ padding: '12px', fontSize: 13, color: '#a5b4fc', fontFamily: 'monospace' }}>
                        {v.validatorId}
                      </td>
                      <td style={{ padding: '12px', fontSize: 13, color: '#22c55e', fontWeight: 700 }}>
                        {typeof v.score === 'number' ? v.score.toFixed(1) : v.score}
                      </td>
                      <td style={{ padding: '12px', fontSize: 13, color: '#94a3b8' }}>{v.totalTasks || 0}</td>
                      <td style={{ padding: '12px', fontSize: 13, color: '#f59e0b', fontWeight: 600 }}>
                        {usd(v.totalEarned)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

 * -----------------------------------------------
 * Client-side React component. Displays 6 go-to-market paths with a scoring
 * matrix and phased roadmap. Optionally fetches live readiness metrics from
 * the engine via GET /api/strategy-metrics.
 *
 * Placement:  apps/web/src/app/strategy/page.jsx
 * Route:      /strategy  (Next.js App Router)
 *
 * Live data hook:
 *   The component attempts to fetch /api/strategy-metrics on mount. If the
 *   API is available it overlays real engine metrics (auditChainLength,
 *   totalMissions, autoFlowRate, etc.) onto the static readiness scores.
 *   If the fetch fails the static values are shown as-is — no crash.
 *
 * Connection to ECOS engine:
 *   /api/strategy-metrics (apps/web/src/app/api/strategy-metrics/route.js)
 *     → src/db/auditRepo.js      (chain length, last hash)
 *     → src/db/approvalRepo.js   (total missions, resolution rates)
 *     → src/db/ledgerRepo.js     (platform balance, total settled USD)
 */

'use client';

import { useState, useEffect } from 'react';

// ── Static option definitions ──────────────────────────────────────────────

const OPTIONS = [
  {
    id: 'A',
    label: 'Infrastructure Layer',
    tagline: '"Stripe for AI Tasks"',
    oneliner:
      'שכבת settlement ואמון שכל בונה מוצר AI משתמש בה — לא מוצר קצה אלא תשתית.',
    analogy:
      'כמו Stripe, Twilio, או Plaid — לא מתחרה ב-apps, הופך לחיוני לכולם.',
    who_pays:
      'חברות SaaS/startups שבונות מוצרי AI ורוצות billing + audit + HITL מחוץ ל-codebase.',
    revenue_model: 'Per-transaction fee (0.5–2%) + SaaS tier לנפח גדול.',
    moat: 'Network effects: ככל שיותר מוצרים בונים עליו, ה-audit trail הופך לסטנדרט תעשייתי.',
    upside: 'TAM ענק — כל AI workflow שנוגע בכסף.',
    risk: 'זמן לשוק ארוך. צריך developer adoption. קשה להסביר ל-non-technical investor.',
    readiness: 70,
    effort: '18–36 חודש',
    color: '#0ea5e9',
    verdict: 'שאפתני ביותר — נכון לטווח ארוך, קשה להוכיח מהר',
  },
  {
    id: 'B',
    label: 'Vertical SaaS — Legal',
    tagline: 'AI לסנגורים, אימות חובה',
    oneliner:
      'עורכי דין משתמשים ב-AI לדראפטים, ECOS מבטיח שאדם מוסמך אימת כל פסקה לפני שיצאה.',
    analogy: 'כמו Clio או Harvey — אבל עם audit trail פיננסי ומשפטי מובנה.',
    who_pays: 'משרדי עורכי דין בינוניים (10–200 עו"ד) שכבר משתמשים ב-AI אבל חוששים מחשיפה.',
    revenue_model: 'SaaS חודשי $500–2,000 לחברה + fee לכל אימות.',
    moat: 'Compliance requirement — ברגע שרגולטור מחייב audit trail, ECOS הופך ל-must-have.',
    upside: 'מכירות מהירות יחסית, חוזי שנה, נכנס דרך pain point אמיתי.',
    risk: 'ורטיקל ספציפי — מגביל. Legal cycles מכירה ארוכים. צריך domain expertise.',
    readiness: 55,
    effort: '6–12 חודש ל-pilot',
    color: '#8b5cf6',
    verdict: 'הכי מהיר לכסף ראשון — proof of concept אמיתי',
  },
  {
    id: 'C',
    label: 'Vertical SaaS — Finance / Compliance',
    tagline: 'AI בפיננסים עם human sign-off',
    oneliner:
      'בנקים, חברות ביטוח, fintech — כל AI output שנוגע בהחלטה פיננסית חייב אישור אנושי מתועד.',
    analogy: 'כמו Veritran או nCino — workflow compliance עם AI בלב.',
    who_pays: 'Fintech ו-RegTech teams שצריכים לעמוד ב-SOX/GDPR/MiFID.',
    revenue_model: 'Enterprise license $50K–200K/year + implementation.',
    moat: 'Regulatory moat — ברגע שעובר audit רגולטורי, כמעט בלתי אפשרי להחליף.',
    upside: 'ACV גבוה מאוד. חוזי רב-שנה. סביבה שמתחייבת לתשלום.',
    risk: 'Sales cycle של 6–18 חודש. צריך SOC2 לפני שיקנו. CISO approval.',
    readiness: 45,
    effort: '12–24 חודש',
    color: '#10b981',
    verdict: 'הכסף הגדול — אבל המסלול הארוך',
  },
  {
    id: 'D',
    label: 'AI Task Marketplace',
    tagline: 'Upwork שבו ה-worker הראשוני הוא AI',
    oneliner:
      'לקוח מפרסם משימה → AI מבצע → validator אנושי מוסמך מאמת ומקבל תשלום אוטומטי.',
    analogy: 'Fiverr + Scale AI + Mechanical Turk — אבל עם AI כשכבה ראשונה ו-economics מובנה.',
    who_pays: 'חברות שצריכות נפח גדול של tasks: annotation, review, classification, drafting.',
    revenue_model: 'Platform fee 20% (כבר מקודד ב-40/40/20). Validators מרוויחים.',
    moat: 'Two-sided network — ככל שיותר validators, יותר לקוחות. ככל שיותר tasks, validators מרוויחים יותר.',
    upside: 'Scale exponential. Model לא תלוי ב-AI provider ספציפי.',
    risk: 'Cold start problem. צריך לגייס שני צדדים בו-זמנית. תחרות עם Scale AI.',
    readiness: 60,
    effort: '12–18 חודש ל-MVP marketplace',
    color: '#f59e0b',
    verdict: 'הכי מעניין לטווח בינוני — אם פותרים את ה-cold start',
  },
  {
    id: 'E',
    label: 'White-Label B2B SDK',
    tagline: 'ECOS כ-engine בתוך מוצרים קיימים',
    oneliner:
      'מוכרים ל-Gumloop, Make, n8n, Zapier — הם מטמיעים את ה-settlement layer שלנו בתוך הפלטפורמה שלהם.',
    analogy: 'כמו Plaid (API לבנקים) או Stripe Connect (marketplace payments) — invisible infrastructure.',
    who_pays: 'Automation platforms שכבר יש להם לקוחות ורוצים להוסיף monetization layer.',
    revenue_model: 'Revenue share מה-transactions שעוברים דרכנו + license fee.',
    moat: 'Integration depth — ברגע שמוטמע, קשה לנתק.',
    upside: 'GTM מהיר — הם מביאים את הלקוחות, אנחנו מביאים את ה-engine.',
    risk: 'תלות בשותפים. יכולים לבנות in-house אחרי שלמדו. Negotiating power נמוך בהתחלה.',
    readiness: 75,
    effort: '3–6 חודש ל-first partnership',
    color: '#ef4444',
    verdict: 'הכי מהיר לשוק — דרך שותפים קיימים',
  },
  {
    id: 'F',
    label: 'Medical / Clinical AI Oversight',
    tagline: 'AI רפואי עם physician sign-off מתועד',
    oneliner:
      'AI מייצר המלצות קליניות/אדמיניסטרטיביות, רופא מאמת, ECOS מתעד לצרכי liability ורגולציה.',
    analogy: 'כמו Nuance DAX או Abridge — אבל עם settlement layer ו-liability trail.',
    who_pays: 'בתי חולים, קופות חולים, חברות ביטוח רפואי.',
    revenue_model: 'Per-encounter fee + enterprise license.',
    moat: 'FDA/CE liability trail — ה-audit chain הוא ה-product מנקודת מבט רגולטורית.',
    upside: 'Healthcare AI שוק $45B עד 2030. Regulatory requirement = captive market.',
    risk: 'הסמכות, pilots ארוכים, procurement cycles של 2+ שנה.',
    readiness: 30,
    effort: '24–48 חודש',
    color: '#06b6d4',
    verdict: 'הפוטנציאל הגדול ביותר — הדרך הארוכה ביותר',
  },
];

const MATRIX = [
  { label: 'מהירות לכסף ראשון', key: 'speed',  scores: { A: 2, B: 8, C: 5, D: 5, E: 9, F: 1 } },
  { label: 'גודל שוק (TAM)',     key: 'tam',    scores: { A: 10, B: 6, C: 9, D: 8, E: 7, F: 10 } },
  { label: 'מוכנות הקוד כרגע',  key: 'ready',  scores: { A: 7, B: 6, C: 5, D: 6, E: 8, F: 3 } },
  { label: 'קלות הסבר למשקיע',  key: 'pitch',  scores: { A: 5, B: 9, C: 8, D: 8, E: 7, F: 7 } },
  { label: 'הגנה מתחרות (moat)', key: 'moat',   scores: { A: 9, B: 7, C: 10, D: 8, E: 6, F: 10 } },
  { label: 'קלות מכירה',         key: 'sales',  scores: { A: 4, B: 6, C: 3, D: 5, E: 8, F: 2 } },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function ECOSStrategy() {
  const [active, setActive] = useState('B');
  const [view, setView]     = useState('cards'); // cards | matrix | comparison
  const [liveMetrics, setLiveMetrics] = useState(null);

  // ── Fetch live engine metrics (non-blocking) ────────────────────────────────
  useEffect(() => {
    fetch('/api/strategy-metrics')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) setLiveMetrics(data);
      })
      .catch(() => { /* silently degrade — static values used */ });
  }, []);

  // Merge live metrics into static readiness scores where available
  const optionsWithLive = OPTIONS.map(o => {
    if (!liveMetrics) return o;
    const override = liveMetrics.readinessOverrides?.[o.id];
    return override !== undefined ? { ...o, readiness: override } : o;
  });

  const opt = optionsWithLive.find(o => o.id === active);

  return (
    <div style={{
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
      background: '#0a0a0f',
      color: '#e2e8f0',
      minHeight: '100vh',
      padding: '0',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&family=Space+Grotesk:wght@400;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0a0a0f; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }
        .opt-card { transition: all 0.18s ease; cursor: pointer; }
        .opt-card:hover { transform: translateY(-2px); }
        .tab-btn { transition: all 0.15s; cursor: pointer; border: none; }
        .tab-btn:hover { opacity: 0.9; }
        .score-bar { transition: width 0.6s cubic-bezier(.4,0,.2,1); }
        .detail-row { border-bottom: 1px solid #1e293b; }
        .detail-row:last-child { border-bottom: none; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ borderBottom: '1px solid #1e293b', padding: '28px 40px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 4, color: '#475569', marginBottom: 6, textTransform: 'uppercase' }}>
              ECOS B2B — Strategic Options
            </div>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 26, fontWeight: 700, color: '#f1f5f9' }}>
              מסמך גיבוש אסטרטגי
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
              6 מסלולים × 6 קריטריונים — לדיון פנימי בלבד
              {liveMetrics && (
                <span style={{ marginLeft: 12, color: '#22c55e' }}>
                  ● live — {liveMetrics.totalMissions ?? 0} missions · {liveMetrics.auditChainLength ?? 0} audit entries
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {['cards', 'matrix', 'comparison'].map(v => (
              <button key={v} className="tab-btn" onClick={() => setView(v)}
                style={{
                  padding: '7px 16px', borderRadius: 6, fontSize: 11, letterSpacing: 1,
                  textTransform: 'uppercase', fontFamily: 'inherit',
                  background: view === v ? '#1e40af' : '#0f172a',
                  color: view === v ? '#bfdbfe' : '#64748b',
                  border: view === v ? '1px solid #3b82f6' : '1px solid #1e293b',
                }}>
                {v === 'cards' ? 'כרטיסים' : v === 'matrix' ? 'מטריצה' : 'השוואה'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── CARDS VIEW ── */}
      {view === 'cards' && (
        <div style={{ display: 'flex', minHeight: 'calc(100vh - 90px)' }}>
          {/* Sidebar */}
          <div style={{ width: 200, borderRight: '1px solid #1e293b', padding: '20px 0', flexShrink: 0 }}>
            {optionsWithLive.map(o => (
              <div key={o.id} className="opt-card" onClick={() => setActive(o.id)}
                style={{
                  padding: '14px 20px',
                  borderLeft: active === o.id ? `3px solid ${o.color}` : '3px solid transparent',
                  background: active === o.id ? '#0f172a' : 'transparent',
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{
                    width: 26, height: 26, borderRadius: 6, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    background: active === o.id ? o.color : '#1e293b',
                    color: active === o.id ? '#fff' : '#94a3b8',
                    fontSize: 12, fontWeight: 600,
                  }}>{o.id}</span>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: active === o.id ? '#f1f5f9' : '#94a3b8', lineHeight: 1.3 }}>
                      {o.label}
                    </div>
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{o.effort}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Detail panel */}
          {opt && (
            <div style={{ flex: 1, padding: '32px 40px', maxWidth: 740, overflowY: 'auto' }}>
              <div style={{ marginBottom: 28 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <span style={{
                    width: 36, height: 36, borderRadius: 8, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    background: opt.color, color: '#fff', fontSize: 16, fontWeight: 700,
                  }}>{opt.id}</span>
                  <div>
                    <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>
                      {opt.label}
                    </div>
                    <div style={{ fontSize: 12, color: opt.color, marginTop: 2 }}>{opt.tagline}</div>
                  </div>
                </div>
                <div style={{
                  fontSize: 15, color: '#cbd5e1', lineHeight: 1.7,
                  padding: '14px 18px', background: '#0f172a',
                  borderRadius: 8, border: '1px solid #1e293b',
                }}>
                  {opt.oneliner}
                </div>
              </div>

              {/* Readiness bar */}
              <div style={{ marginBottom: 28 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>
                    מוכנות נוכחית של הקוד{liveMetrics ? ' (live)' : ''}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: opt.color }}>{opt.readiness}%</span>
                </div>
                <div style={{ height: 5, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
                  <div className="score-bar" style={{ height: '100%', width: `${opt.readiness}%`, background: opt.color, borderRadius: 3 }} />
                </div>
              </div>

              {/* Detail rows */}
              <div style={{ border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden', marginBottom: 24 }}>
                {[
                  { label: 'אנלוגיה',         value: opt.analogy },
                  { label: 'מי משלם',          value: opt.who_pays },
                  { label: 'מודל הכנסות',      value: opt.revenue_model },
                  { label: 'חפיר תחרותי',      value: opt.moat },
                  { label: 'זמן מימוש',        value: opt.effort },
                ].map(row => (
                  <div key={row.label} className="detail-row" style={{ display: 'flex', padding: '13px 18px', gap: 16 }}>
                    <div style={{ width: 120, flexShrink: 0, fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, paddingTop: 2 }}>
                      {row.label}
                    </div>
                    <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.6 }}>{row.value}</div>
                  </div>
                ))}
              </div>

              {/* Upside / Risk */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
                <div style={{ padding: '14px 16px', background: '#052e16', borderRadius: 8, border: '1px solid #14532d' }}>
                  <div style={{ fontSize: 10, color: '#4ade80', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>↑ Upside</div>
                  <div style={{ fontSize: 12, color: '#bbf7d0', lineHeight: 1.6 }}>{opt.upside}</div>
                </div>
                <div style={{ padding: '14px 16px', background: '#2d1515', borderRadius: 8, border: '1px solid #7f1d1d' }}>
                  <div style={{ fontSize: 10, color: '#f87171', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>↓ Risk</div>
                  <div style={{ fontSize: 12, color: '#fecaca', lineHeight: 1.6 }}>{opt.risk}</div>
                </div>
              </div>

              {/* Verdict */}
              <div style={{
                padding: '14px 18px', borderRadius: 8,
                background: `${opt.color}15`,
                border: `1px solid ${opt.color}40`,
              }}>
                <div style={{ fontSize: 10, color: opt.color, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 5 }}>verdict</div>
                <div style={{ fontSize: 14, color: '#f1f5f9', fontWeight: 500 }}>{opt.verdict}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── MATRIX VIEW ── */}
      {view === 'matrix' && (
        <div style={{ padding: '32px 40px', overflowX: 'auto' }}>
          <div style={{ fontSize: 12, color: '#475569', marginBottom: 24 }}>ציון 1–10 לכל מסלול לפי קריטריון</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '10px 14px', fontSize: 11, color: '#475569', borderBottom: '1px solid #1e293b', fontWeight: 400 }}>
                  קריטריון
                </th>
                {optionsWithLive.map(o => (
                  <th key={o.id} style={{ textAlign: 'center', padding: '10px 14px', borderBottom: '1px solid #1e293b' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 28, height: 28, borderRadius: 6,
                      background: o.color, color: '#fff', fontSize: 13, fontWeight: 700,
                    }}>{o.id}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MATRIX.map((row, ri) => {
                const max = Math.max(...optionsWithLive.map(o => row.scores[o.id]));
                return (
                  <tr key={row.key} style={{ background: ri % 2 === 0 ? '#0a0a0f' : '#0d111a' }}>
                    <td style={{ padding: '13px 14px', fontSize: 12, color: '#94a3b8', borderBottom: '1px solid #1e293b11' }}>
                      {row.label}
                    </td>
                    {optionsWithLive.map(o => {
                      const score = row.scores[o.id];
                      const isMax = score === max;
                      return (
                        <td key={o.id} style={{ textAlign: 'center', padding: '13px 14px', borderBottom: '1px solid #1e293b11' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 32, height: 32, borderRadius: 6,
                            background: isMax ? `${o.color}30` : '#1e293b',
                            color: isMax ? o.color : '#64748b',
                            fontSize: 13, fontWeight: isMax ? 700 : 400,
                            border: isMax ? `1px solid ${o.color}60` : '1px solid transparent',
                          }}>{score}</span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {/* Totals */}
              <tr style={{ background: '#0f172a' }}>
                <td style={{ padding: '14px 14px', fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
                  סה"כ
                </td>
                {optionsWithLive.map(o => {
                  const total = MATRIX.reduce((sum, row) => sum + row.scores[o.id], 0);
                  const maxTotal = Math.max(...optionsWithLive.map(opt2 => MATRIX.reduce((s, r) => s + r.scores[opt2.id], 0)));
                  return (
                    <td key={o.id} style={{ textAlign: 'center', padding: '14px 14px' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 36, height: 36, borderRadius: 7,
                        background: total === maxTotal ? `${o.color}25` : '#1e293b',
                        color: total === maxTotal ? o.color : '#94a3b8',
                        fontSize: 14, fontWeight: 700,
                        border: total === maxTotal ? `1px solid ${o.color}50` : '1px solid #334155',
                      }}>{total}</span>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>

          <div style={{ marginTop: 32, padding: '20px 24px', background: '#0f172a', borderRadius: 10, border: '1px solid #1e293b', maxWidth: 560 }}>
            <div style={{ fontSize: 11, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>קריאה מהמטריצה</div>
            {[
              { id: 'E', text: 'הכי מהיר לביצוע עם הקוד הנוכחי — דרך שותפים קיימים' },
              { id: 'B', text: 'הכי ברור לסגור לקוח ראשון ולהוכיח revenue' },
              { id: 'A', text: 'הנרטיב הכי חזק למשקיע, אבל דורש הוכחה ראשונה' },
              { id: 'D', text: 'הפוטנציאל הכי מעניין לטווח בינוני אם פותרים cold start' },
            ].map(item => {
              const o = optionsWithLive.find(x => x.id === item.id);
              return (
                <div key={item.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 10 }}>
                  <span style={{
                    width: 22, height: 22, borderRadius: 5, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', flexShrink: 0,
                    background: o.color, color: '#fff', fontSize: 11, fontWeight: 700, marginTop: 1,
                  }}>{item.id}</span>
                  <span style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>{item.text}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── COMPARISON VIEW ── */}
      {view === 'comparison' && (
        <div style={{ padding: '32px 40px', maxWidth: 780 }}>
          <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>
            רצף מומלץ — שלבים לא מסלולים בלעדיים
          </div>
          <div style={{ fontSize: 13, color: '#334155', marginBottom: 32 }}>
            ניתן להתחיל ב-B כדי להוכיח revenue ולמקביל לפתח E, ואז לבנות על זה לנרטיב A.
          </div>

          {[
            {
              phase: 'Phase 1', title: 'הוכחת כסף', time: '0–6 חודש',
              options: ['E', 'B'],
              desc: 'יצירת revenue ראשון. E דרך שותפות עם platform קיים, B דרך לקוח legal ראשון. מטרה: $5K–20K MRR ו-proof שמישהו משלם.',
              milestone: 'לקוח ראשון + $10K ARR',
            },
            {
              phase: 'Phase 2', title: 'גיוס Pre-Seed', time: '6–12 חודש',
              options: ['A', 'D'],
              desc: 'עם revenue ראשון, ניתן להציג למשקיעים נרטיב A (\'Stripe for AI\') עם D כ-marketplace play. הנרטיב: infrastructure שכולם יצטרכו.',
              milestone: '$500K–2M raise, SOC2 Type I',
            },
            {
              phase: 'Phase 3', title: 'ורטיקל עמוק', time: '12–24 חודש',
              options: ['C', 'F'],
              desc: 'עם כסף ומוצר מוכח, ניתן להיכנס לverticals הרגולטוריים הגדולים. C ו-F הם חוזים גדולים אבל דורשים compliance שלוקח זמן.',
              milestone: 'Enterprise חוזה ראשון $100K+',
            },
          ].map((phase, pi) => (
            <div key={pi} style={{
              marginBottom: 20, padding: '22px 24px',
              background: '#0d111a', borderRadius: 10,
              border: '1px solid #1e293b',
              borderLeft: '3px solid #3b82f6',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <span style={{
                  fontSize: 10, color: '#3b82f6', letterSpacing: 2,
                  textTransform: 'uppercase', background: '#1e3a5f',
                  padding: '3px 10px', borderRadius: 4,
                }}>{phase.phase}</span>
                <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>
                  {phase.title}
                </span>
                <span style={{ fontSize: 11, color: '#475569', marginLeft: 'auto' }}>{phase.time}</span>
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                {phase.options.map(id => {
                  const o = optionsWithLive.find(x => x.id === id);
                  return (
                    <span key={id} style={{
                      padding: '4px 12px', borderRadius: 5, fontSize: 12,
                      background: `${o.color}20`, color: o.color,
                      border: `1px solid ${o.color}40`, fontWeight: 600,
                    }}>
                      {id} — {o.label}
                    </span>
                  );
                })}
              </div>

              <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.7, marginBottom: 14 }}>
                {phase.desc}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: 1 }}>Milestone:</span>
                <span style={{ fontSize: 12, color: '#4ade80', fontWeight: 500 }}>{phase.milestone}</span>
              </div>
            </div>
          ))}

          {/* Open questions */}
          <div style={{ marginTop: 32, padding: '20px 24px', background: '#12100a', borderRadius: 10, border: '1px solid #292119' }}>
            <div style={{ fontSize: 11, color: '#92400e', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
              שאלות פתוחות לדיון
            </div>
            {[
              'האם יש כבר שיחה עם מישהו שרוצה לשלם — legal, fintech, automation platform?',
              'מה הצוות הנוכחי — developer אחד? האם יש capacity למכירות?',
              'האם העדיפות היא גיוס מהיר מ-sophisticated investors או לקוח ראשון קודם?',
              'מה הגרסה של ה-story ל-YC / local VCs — B2B tool או infrastructure play?',
              'האם יש domain expertise בתחום ספציפי שמקל כניסה לvertical?',
            ].map((q, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
                <span style={{ color: '#d97706', fontSize: 12, marginTop: 2, flexShrink: 0 }}>?</span>
                <span style={{ fontSize: 13, color: '#92400e', lineHeight: 1.6 }}>{q}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
