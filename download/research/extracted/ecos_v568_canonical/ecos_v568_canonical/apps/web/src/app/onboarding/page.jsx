'use client';

import { useState, useEffect } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const CREDIT_SYMBOL = '⊙';

export default function OnboardingPage() {
  const [userId, setUserId] = useState('');
  const [started, setStarted] = useState(false);
  const [currentTask, setCurrentTask] = useState(null);
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [step, setStep] = useState('intro'); // intro | task | result | complete
  const [timeLeft, setTimeLeft] = useState(60);
  const [streak, setStreak] = useState(0);
  const [totalEarned, setTotalEarned] = useState(0);

  // Task 2 - Automatic on first load, persistent for session, invisible to user
  useEffect(() => {
    let uid = null;
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        uid = sessionStorage.getItem('ecos_uid') || (() => {
          const id = crypto.randomUUID();
          sessionStorage.setItem('ecos_uid', id);
          return id;
        })();
        setUserId(uid);
      }
    } catch (_) {}
  }, []);

  // Task 4 - Countdown timer
  useEffect(() => {
    if (step !== 'task' || !currentTask) return;

    setTimeLeft(currentTask.maxSeconds || 60);
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [step, currentTask]);

  // Task 5 - Automatic redirect after 3 seconds on completion
  useEffect(() => {
    if (step === 'complete') {
      const redirectTimer = setTimeout(() => {
        window.location.href = '/chat?welcome=true&earned=125000';
      }, 3000);
      return () => clearTimeout(redirectTimer);
    }
  }, [step]);

  const startOnboarding = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/onboarding/next-task/${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (data.done) {
        setDone(true);
        setStep('complete');
      } else {
        setCurrentTask(data.task);
        setStep('task');
        setStarted(true);
      }
    } catch (e) {
      alert('Error starting onboarding: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const submitAnswer = async () => {
    if (!selected || !currentTask) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/onboarding/complete-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, taskId: currentTask.id, answer: selected }),
      });
      const data = await res.json();
      setResult(data);

      if (data.isCorrect) {
        setStreak(prev => prev + 1);
        setTotalEarned(prev => prev + 0.25);
      } else {
        setStreak(0);
      }

      const prog = await fetch(`${API_BASE}/api/v1/onboarding/progress/${encodeURIComponent(userId)}`);
      setProgress(await prog.json());
      setStep('result');
    } catch (e) {
      alert('Error submitting answer: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const nextTask = async () => {
    setSelected(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/onboarding/next-task/${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (data.done) {
        setDone(true);
        setStep('complete');
      } else {
        setCurrentTask(data.task);
        setStep('task');
      }
    } catch (e) {
      alert('Error loading next task: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{ width: '100%', maxWidth: 560 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🚀</div>
          <h1 style={{ color: '#fff', fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>ECOS Onboarding</h1>
          <p style={{ color: '#94a3b8', marginTop: '0.5rem' }}>Complete orientation tasks and earn real money</p>
        </div>

        {/* Card */}
        <div style={{
          background: '#1e293b',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: 16,
          padding: '2rem',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          color: '#f3f4f6'
        }}>

          {/* TASK 3 — PRE-TASK VALUE SCREEN */}
          {step === 'intro' && (
            <div>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#ffffff', marginBottom: '12px', textAlign: 'center' }}>
                Here's how ECOS works
              </h2>
              <p style={{ color: '#94a3b8', fontSize: '1rem', lineHeight: 1.6, marginBottom: '24px', textAlign: 'center' }}>
                You review short AI decisions. Accurate reviews earn credits. Most tasks take under a minute.
              </p>
              
              <div style={{
                background: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.2)',
                borderRadius: 12,
                padding: '16px',
                marginBottom: '24px',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: '12px', color: '#3b82f6', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                  Progress Indicator
                </div>
                <div style={{ fontSize: '2rem', fontWeight: 900, color: '#60a5fa' }}>
                  {CREDIT_SYMBOL}0 / {CREDIT_SYMBOL}1.25
                </div>
              </div>

              <button
                onClick={startOnboarding}
                disabled={loading || !userId}
                style={{
                  width: '100%',
                  padding: '1rem',
                  background: '#7c3aed',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  fontWeight: 700,
                  fontSize: '1rem',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(124, 58, 237, 0.3)',
                  opacity: loading ? 0.7 : 1
                }}
              >
                {loading ? 'Initializing...' : 'Show me task #1'}
              </button>
            </div>
          )}

          {/* TASK */}
          {step === 'task' && currentTask && (
            <div>
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.5rem' }}>
                  <span>Task {progress ? progress.completedCount + 1 : 1} of 5</span>
                  <span style={{ fontWeight: 'bold', color: '#10b981' }}>Live Balance: {CREDIT_SYMBOL}{totalEarned.toFixed(2)}</span>
                </div>
                
                {/* ProgressBar */}
                <div style={{ height: 6, background: '#334155', borderRadius: 3, marginBottom: '12px' }}>
                  <div style={{
                    height: '100%',
                    background: '#7c3aed',
                    borderRadius: 3,
                    width: progress ? progress.percentComplete + '%' : '0%',
                    transition: 'width 0.4s'
                  }} />
                </div>

                {/* Task Stats (Timer + Streak) */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px' }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '0.85rem',
                    color: timeLeft <= 10 ? '#ef4444' : '#60a5fa',
                    fontWeight: 700,
                    animation: timeLeft <= 10 ? 'pulse 1s infinite' : 'none'
                  }}>
                    ⏱️ {timeLeft}s remaining
                  </span>
                  
                  {streak > 0 && (
                    <span style={{
                      background: 'rgba(249, 115, 22, 0.2)',
                      color: '#fdba74',
                      padding: '2px 8px',
                      borderRadius: '9999px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      {streak} correct in a row 🔥
                    </span>
                  )}
                </div>
              </div>

              <div style={{
                display: 'inline-block',
                background: 'rgba(59, 130, 246, 0.1)',
                color: '#60a5fa',
                borderRadius: 6,
                padding: '0.25rem 0.6rem',
                fontSize: '0.75rem',
                fontWeight: 700,
                marginBottom: '1rem',
                textTransform: 'uppercase',
                border: '1px solid rgba(59, 130, 246, 0.2)'
              }}>
                {currentTask.domain}
              </div>

              <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#ffffff', marginBottom: '1.25rem', lineHeight: 1.5 }}>
                {currentTask.question}
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.5rem' }}>
                {currentTask.options?.map(option => (
                  <button
                    key={option}
                    onClick={() => setSelected(option)}
                    style={{
                      padding: '0.85rem 1rem',
                      borderRadius: 10,
                      border: `2px solid ${selected === option ? '#7c3aed' : 'rgba(255,255,255,0.1)'}`,
                      background: selected === option ? 'rgba(124, 58, 237, 0.15)' : '#1e293b',
                      color: selected === option ? '#ffffff' : '#cbd5e1',
                      textAlign: 'left',
                      fontWeight: selected === option ? 700 : 500,
                      cursor: 'pointer',
                      fontSize: '0.95rem',
                      transition: 'all 0.15s',
                    }}
                  >
                    {option}
                  </button>
                ))}
              </div>

              <button
                onClick={submitAnswer}
                disabled={loading || !selected}
                style={{
                  width: '100%',
                  padding: '0.85rem',
                  background: '#7c3aed',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(124, 58, 237, 0.2)',
                  opacity: !selected || loading ? 0.5 : 1
                }}
              >
                {loading ? 'Submitting...' : 'Submit Answer'}
              </button>
            </div>
          )}

          {/* RESULT */}
          {step === 'result' && result && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>{result.isCorrect ? '✅' : '📘'}</div>
              <h2 style={{ fontWeight: 800, color: '#ffffff', marginBottom: '0.5rem' }}>
                {result.isCorrect ? 'Correct!' : 'Good try!'}
              </h2>
              
              {!result.isCorrect && (
                <div style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 10,
                  padding: '1rem',
                  marginBottom: '1.25rem',
                  textAlign: 'left'
                }}>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.25rem' }}>Correct answer:</div>
                  <div style={{ fontWeight: 600, color: '#ffffff', fontSize: '0.95rem' }}>{result.correctAnswer}</div>
                </div>
              )}

              <div style={{
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1.5px solid #10b981',
                borderRadius: 10,
                padding: '1rem',
                marginBottom: '1.5rem'
              }}>
                <div style={{ fontWeight: 800, color: '#34d399', fontSize: '1.3rem' }}>
                  +{CREDIT_SYMBOL}0.25 earned
                </div>
                {progress && (
                  <div style={{ color: '#a7f3d0', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                    Total: {CREDIT_SYMBOL}{(progress.totalEarnedMicro / 1_000_000).toFixed(2)} across {progress.completedCount} tasks
                  </div>
                )}
              </div>

              {progress && !progress.allDone && (
                <button
                  onClick={nextTask}
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '0.85rem',
                    background: '#7c3aed',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 10,
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    cursor: 'pointer'
                  }}
                >
                  Next Task →
                </button>
              )}
            </div>
          )}

          {/* TASK 5 — COMPLETION FLOW */}
          {step === 'complete' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
              <h2 style={{ fontWeight: 800, color: '#ffffff', marginBottom: '8px' }}>Onboarding Complete!</h2>
              
              <div style={{
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1.5px solid #10b981',
                borderRadius: 12,
                padding: '1.5rem',
                marginBottom: '1.5rem'
              }}>
                <div style={{ fontWeight: 900, color: '#34d399', fontSize: '1.6rem', marginBottom: '4px' }}>
                  You earned {CREDIT_SYMBOL}1.25 today.
                </div>
                <div style={{ color: '#a7f3d0', fontSize: '0.9rem' }}>
                  All 5 orientation tasks completed successfully.
                </div>
              </div>

              <div style={{
                background: 'rgba(255, 255, 255, 0.05)',
                borderRadius: 10,
                padding: '12px 16px',
                marginBottom: '20px',
                textAlign: 'left',
                border: '1px solid rgba(255, 255, 255, 0.1)'
              }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '2px' }}>Your unique Validator ID:</div>
                <div style={{ fontFamily: 'monospace', fontSize: '14px', color: '#60a5fa', fontWeight: 700, wordBreak: 'break-all' }}>
                  {userId}
                </div>
              </div>

              <p style={{ color: '#94a3b8', fontSize: '0.95rem', marginBottom: '24px', lineHeight: 1.5 }}>
                First real task is waiting. Redirecting to chat in 3 seconds...
              </p>

              <a
                href="/chat?welcome=true&earned=125000"
                style={{
                  display: 'block',
                  padding: '1rem',
                  background: '#10b981',
                  color: '#fff',
                  textDecoration: 'none',
                  borderRadius: 10,
                  fontWeight: 700,
                  fontSize: '1rem',
                  boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
                }}
              >
                Enter chat →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
