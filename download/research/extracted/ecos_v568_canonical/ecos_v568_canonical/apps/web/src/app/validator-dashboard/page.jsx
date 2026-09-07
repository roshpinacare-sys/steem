'use client';
import React, { useState, useEffect, useCallback } from 'react';

const EXPRESS_BASE = typeof window !== 'undefined' && window.__ECOS_EXPRESS_URL__ ? window.__ECOS_EXPRESS_URL__ : (process.env.NEXT_PUBLIC_EXPRESS_URL || 'http://localhost:3000');

const STAGE_COLORS = { USE:{bg:'#e0f2fe',text:'#0369a1',border:'#7dd3fc'}, VERIFY:{bg:'#dcfce7',text:'#166534',border:'#86efac'}, OWN:{bg:'#fef9c3',text:'#854d0e',border:'#fde047'}, RECRUIT:{bg:'#fce7f3',text:'#9d174d',border:'#f9a8d4'}, MENTOR:{bg:'#ede9fe',text:'#5b21b6',border:'#c4b5fd'} };
const SYBIL_BADGES = { ALLOW:{bg:'#dcfce7',text:'#166534',label:'✓ Verified'}, REVIEW:{bg:'#fef9c3',text:'#854d0e',label:'⏳ Under Review'}, BLOCK:{bg:'#fee2e2',text:'#991b1b',label:'✗ Blocked'}, UNKNOWN:{bg:'#f3f4f6',text:'#374151',label:'? Unknown'} };

function AccuracyBar({accuracy, passing}) {
  const pct = Math.round((accuracy||0)*100);
  const color = passing ? '#22c55e' : (pct>=60?'#f59e0b':'#ef4444');
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
        <span style={{fontSize:13,color:'#6b7280'}}>Accuracy</span>
        <span style={{fontSize:13,fontWeight:700,color}}>{pct}%</span>
      </div>
      <div style={{background:'#e5e7eb',borderRadius:6,height:8,overflow:'hidden'}}>
        <div style={{width:`${pct}%`,height:'100%',background:color,borderRadius:6,transition:'width 0.5s ease'}}/>
      </div>
      <div style={{fontSize:11,color:'#9ca3af',marginTop:3}}>{passing?'✓ Passing (≥80%)':'Needs ≥80% to pass quality gate'}</div>
    </div>
  );
}

function StatCard({title, children, style={}}) {
  return (
    <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,padding:'20px 24px',flex:'1 1 220px',minWidth:220,boxShadow:'0 1px 3px rgba(0,0,0,0.07)',...style}}>
      <div style={{fontSize:11,fontWeight:600,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:12}}>{title}</div>
      {children}
    </div>
  );
}

export default function ValidatorDashboardPage() {
  const [inputId, setInputId] = useState('');
  const [validatorId, setValidatorId] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchDashboard = useCallback(async (id) => {
    if (!id) return;
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`${EXPRESS_BASE}/api/v1/validator/dashboard/${encodeURIComponent(id)}`, {credentials:'include'});
      const data = await res.json();
      if (!data.ok) throw new Error(data.error||'Request failed');
      setDashboard(data);
    } catch(e) { setError(e.message); setDashboard(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const id = params.get('validatorId')||params.get('id');
    if (id) { setInputId(id); setValidatorId(id); fetchDashboard(id); }
  }, [fetchDashboard]);

  useEffect(() => { if (validatorId) fetchDashboard(validatorId); }, [validatorId, fetchDashboard]);

  const graduation = dashboard?.graduation || {};
  const goldenTask = dashboard?.goldenTask || {};
  const sybil      = SYBIL_BADGES[dashboard?.sybilVerdict] || SYBIL_BADGES.UNKNOWN;
  const stageColor = STAGE_COLORS[graduation.stageName] || STAGE_COLORS.USE;
  const earnings   = dashboard?.earnings || {};

  return (
    <div style={{minHeight:'100vh',background:'#f9fafb',padding:'32px 24px',fontFamily:'system-ui, sans-serif'}}>
      <div style={{maxWidth:900,margin:'0 auto'}}>
        <div style={{marginBottom:28}}>
          <h1 style={{fontSize:26,fontWeight:700,color:'#111827',margin:0}}>Validator Dashboard</h1>
          <p style={{color:'#6b7280',margin:'6px 0 0',fontSize:14}}>Aggregated performance view — V117</p>
        </div>

        <div style={{display:'flex',gap:10,marginBottom:28}}>
          <input type="text" placeholder="validator::alice_001" value={inputId}
            onChange={e=>setInputId(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&setValidatorId(inputId.trim())}
            style={{flex:1,padding:'10px 14px',border:'1px solid #d1d5db',borderRadius:8,fontSize:14,outline:'none',background:'#fff'}}/>
          <button onClick={()=>setValidatorId(inputId.trim())} disabled={loading||!inputId.trim()}
            style={{padding:'10px 20px',background:'#2563eb',color:'#fff',border:'none',borderRadius:8,fontSize:14,fontWeight:600,cursor:loading?'not-allowed':'pointer',opacity:loading?0.7:1}}>
            {loading?'Loading…':'Look Up'}
          </button>
        </div>

        {error && <div style={{background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:8,padding:'12px 16px',color:'#991b1b',marginBottom:20,fontSize:14}}>{error}</div>}

        {dashboard && (
          <>
            <div style={{marginBottom:20,fontSize:13,color:'#6b7280'}}>
              Showing data for <strong style={{color:'#374151'}}>{dashboard.validatorId}</strong>
              {' · '}<span>Generated {new Date(dashboard.generatedAt).toLocaleTimeString()}</span>
            </div>
            <div style={{display:'flex',flexWrap:'wrap',gap:16,marginBottom:24}}>
              <StatCard title="Graduation Stage">
                <div style={{display:'inline-block',background:stageColor.bg,color:stageColor.text,border:`1.5px solid ${stageColor.border}`,borderRadius:8,padding:'6px 14px',fontWeight:700,fontSize:18,marginBottom:10}}>
                  {graduation.stageName||'USE'}
                </div>
                <div style={{fontSize:13,color:'#6b7280'}}>Stage {graduation.stageId||1} of 5</div>
                {graduation.unlockedAt && <div style={{fontSize:11,color:'#9ca3af',marginTop:4}}>Unlocked {new Date(graduation.unlockedAt).toLocaleDateString()}</div>}
              </StatCard>
              <StatCard title="Golden Task Score">
                <div style={{fontSize:26,fontWeight:700,color:goldenTask.passing?'#16a34a':'#dc2626',marginBottom:8}}>{goldenTask.correct||0}/{goldenTask.total||0}</div>
                <AccuracyBar accuracy={goldenTask.accuracy} passing={goldenTask.passing}/>
              </StatCard>
              <StatCard title="Identity Status">
                <div style={{display:'inline-block',background:sybil.bg,color:sybil.text,borderRadius:8,padding:'8px 16px',fontWeight:700,fontSize:16,marginBottom:8}}>{sybil.label}</div>
                <div style={{fontSize:12,color:'#9ca3af'}}>Sybil resistance verdict</div>
              </StatCard>
              <StatCard title="Today's Earnings">
                <div style={{fontSize:28,fontWeight:700,color:'#111827',marginBottom:4}}>${earnings.totalUsd||'0.0000'}</div>
                <div style={{display:'flex',gap:16,fontSize:12,color:'#6b7280',marginTop:8}}>
                  <div><div style={{fontWeight:600,color:'#374151'}}>${earnings.taskUsd||'0.0000'}</div><div>Task earnings</div></div>
                  <div><div style={{fontWeight:600,color:'#374151'}}>${earnings.royaltyUsd||'0.0000'}</div><div>Royalties</div></div>
                </div>
              </StatCard>
            </div>
            <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:12,padding:'20px 24px',boxShadow:'0 1px 3px rgba(0,0,0,0.07)'}}>
              <div style={{fontSize:12,fontWeight:600,color:'#9ca3af',textTransform:'uppercase',letterSpacing:'0.08em',marginBottom:16}}>Graduation Ladder</div>
              <div style={{display:'flex',gap:0,alignItems:'center'}}>
                {Object.entries(STAGE_COLORS).map(([name,color],idx)=>{
                  const isActive=(graduation.stageName||'USE')===name;
                  const isPast=(graduation.stageId||1)>(idx+1);
                  const opacity=isPast||isActive?1:0.35;
                  return (
                    <React.Fragment key={name}>
                      <div style={{textAlign:'center',opacity}}>
                        <div style={{width:44,height:44,borderRadius:'50%',background:isActive?color.bg:(isPast?color.bg:'#f3f4f6'),border:`2px solid ${isActive?color.border:(isPast?color.border:'#e5e7eb')}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,color:isActive?color.text:(isPast?color.text:'#9ca3af'),margin:'0 auto 6px',boxShadow:isActive?`0 0 0 3px ${color.border}55`:'none'}}>{idx+1}</div>
                        <div style={{fontSize:10,fontWeight:isActive?700:500,color:isActive?color.text:'#9ca3af'}}>{name}</div>
                      </div>
                      {idx<4&&<div style={{flex:1,height:2,background:isPast?'#86efac':'#e5e7eb',margin:'0 4px 20px'}}/>}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
            <div style={{marginTop:16,fontSize:11,color:'#9ca3af',textAlign:'right'}}>ECOS V117 · Validator Dashboard</div>
          </>
        )}

        {!dashboard&&!loading&&!error&&(
          <div style={{textAlign:'center',padding:'60px 20px',color:'#9ca3af'}}>
            <div style={{fontSize:40,marginBottom:12}}>🔍</div>
            <div style={{fontSize:15}}>Enter a Validator ID above to view their dashboard</div>
            <div style={{fontSize:13,marginTop:6}}>Format: <code style={{background:'#f3f4f6',padding:'2px 6px',borderRadius:4}}>validator::user_001</code></div>
          </div>
        )}
      </div>
    </div>
  );
}
