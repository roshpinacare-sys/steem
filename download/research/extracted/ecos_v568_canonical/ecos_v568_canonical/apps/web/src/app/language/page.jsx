'use client';

/**
 * ECOS — Language Bridge Page (V130)
 * LANG-UI: Live multilingual session UI with RTL support (Hebrew, Arabic)
 *
 * Features:
 *  - Set language profile for current user
 *  - Start a language bridge session between two users
 *  - Send messages (auto-translated by LanguageBridge)
 *  - Live display of bridged messages per participant
 *  - RTL layout auto-applied for Hebrew / Arabic / Persian
 *  - View leaderboard of top multilingual contributors
 *  - View language pair stats
 */

import { useState, useRef, useEffect } from 'react';

// ─── RTL languages ────────────────────────────────────────────────────────────
const RTL_LANGS = new Set(['he', 'ar', 'fa']);

const LANG_NAMES = {
  he: 'עברית (Hebrew)', ar: 'العربية (Arabic)', en: 'English',
  es: 'Español', fr: 'Français', de: 'Deutsch', zh: '中文',
  ja: '日本語', pt: 'Português', ru: 'Русский', hi: 'हिन्दी',
  tr: 'Türkçe', ko: '한국어', it: 'Italiano', nl: 'Nederlands',
  pl: 'Polski', uk: 'Українська', fa: 'فارسی', id: 'Bahasa Indonesia',
  sw: 'Swahili',
};

const FLAG = {
  he: '🇮🇱', ar: '🇸🇦', en: '🇬🇧', es: '🇪🇸', fr: '🇫🇷',
  de: '🇩🇪', zh: '🇨🇳', ja: '🇯🇵', pt: '🇧🇷', ru: '🇷🇺',
  hi: '🇮🇳', tr: '🇹🇷', ko: '🇰🇷', it: '🇮🇹', nl: '🇳🇱',
  pl: '🇵🇱', uk: '🇺🇦', fa: '🇮🇷', id: '🇮🇩', sw: '🇹🇿',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function apiPost(path, body) {
  const r = await fetch(`/api/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}
async function apiGet(path) {
  const r = await fetch(`/api/v1${path}`);
  return r.json();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LangSelect({ value, onChange, label }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-400 uppercase tracking-wide">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-gray-800 text-white border border-gray-600 rounded px-3 py-2 text-sm focus:border-blue-500 outline-none"
      >
        {Object.entries(LANG_NAMES).map(([code, name]) => (
          <option key={code} value={code}>{FLAG[code]} {name}</option>
        ))}
      </select>
    </div>
  );
}

function MessageBubble({ msg, isOwn }) {
  const isRTL = RTL_LANGS.has(msg.lang);
  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'} mb-2`}>
      <div
        dir={isRTL ? 'rtl' : 'ltr'}
        className={`max-w-xs px-4 py-2 rounded-2xl text-sm shadow
          ${isOwn
            ? 'bg-blue-600 text-white rounded-br-none'
            : 'bg-gray-700 text-gray-100 rounded-bl-none'
          }`}
      >
        <div className="text-xs opacity-60 mb-1">
          {FLAG[msg.lang] || '🌐'} {LANG_NAMES[msg.lang] || msg.lang}
          {msg.translated && <span className="ml-1 italic text-yellow-300">↻ translated</span>}
        </div>
        <div>{msg.content}</div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LanguagePage() {
  // Profile setup
  const [userAId, setUserAId] = useState('user-il');
  const [userBId, setUserBId] = useState('user-jo');
  const [langA, setLangA] = useState('he');
  const [langB, setLangB] = useState('ar');
  const [profileMsg, setProfileMsg] = useState('');

  // Session
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);      // flat list for display
  const [inputA, setInputA] = useState('');
  const [inputB, setInputB] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionStatus, setSessionStatus] = useState('');

  // Leaderboard + stats
  const [tab, setTab] = useState('session');         // 'session' | 'leaderboard' | 'stats'
  const [leaderboard, setLeaderboard] = useState([]);
  const [bridgeStats, setBridgeStats] = useState(null);
  const [loadingBoard, setLoadingBoard] = useState(false);

  const messagesEndRef = useRef(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function setProfiles() {
    const [rA, rB] = await Promise.all([
      apiPost('/language/profiles', { userId: userAId, primary: langA }),
      apiPost('/language/profiles', { userId: userBId, primary: langB }),
    ]);
    setProfileMsg(rA.ok && rB.ok
      ? `✓ Profiles set: ${userAId}→${langA}, ${userBId}→${langB}`
      : `Error: ${rA.error || rB.error}`
    );
  }

  async function startSession() {
    const r = await apiPost('/language/sessions', { participantIds: [userAId, userBId] });
    if (r.ok) {
      setSessionId(r.session.sessionId);
      setMessages([]);
      setSessionStatus(`Session started: ${r.session.sessionId}`);
    } else {
      setSessionStatus(`Error: ${r.error}`);
    }
  }

  async function sendMessage(fromUserId, content, clearFn) {
    if (!sessionId || !content.trim()) return;
    setSending(true);
    const r = await apiPost(`/language/sessions/${sessionId}/message`, {
      fromUserId, content,
    });
    if (r.ok && Array.isArray(r.messages)) {
      setMessages(prev => [...prev, ...r.messages.map(m => ({ ...m, isOwn: m.forUserId === fromUserId }))]);
      clearFn('');
    } else {
      setSessionStatus(`Send error: ${r.error}`);
    }
    setSending(false);
  }

  async function closeSession() {
    if (!sessionId) return;
    const r = await apiPost(`/language/sessions/${sessionId}/close`, { validatorId: 'system' });
    setSessionStatus(r.ok
      ? `Session closed. Bridged: ${r.summary?.bridgedCount ?? 0} messages.`
      : `Error: ${r.error}`
    );
    setSessionId(null);
  }

  async function loadLeaderboard() {
    setLoadingBoard(true);
    const r = await apiGet('/language/leaderboard?limit=10');
    if (r.ok) setLeaderboard(r.leaderboard || []);
    setLoadingBoard(false);
  }

  async function loadStats() {
    const r = await apiGet('/language/stats');
    if (r.ok) setBridgeStats(r);
  }

  useEffect(() => {
    if (tab === 'leaderboard') loadLeaderboard();
    if (tab === 'stats') loadStats();
  }, [tab]);

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-1">
            🌐 Language Bridge
          </h1>
          <p className="text-gray-400 text-sm">
            V130 · Linguistic Sovereignty · 20 languages · RTL supported
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {['session', 'leaderboard', 'stats'].map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition
                ${tab === t
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
            >
              {t === 'session' ? '💬 Session' : t === 'leaderboard' ? '🏆 Leaderboard' : '📊 Stats'}
            </button>
          ))}
        </div>

        {/* ── SESSION TAB ─────────────────────────────────────────────────── */}
        {tab === 'session' && (
          <div className="space-y-6">

            {/* Profile Setup */}
            <div className="bg-gray-800 rounded-2xl p-5 border border-gray-700">
              <h2 className="text-lg font-semibold mb-4">1. Set Language Profiles</h2>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-400 uppercase tracking-wide block mb-1">User A ID</label>
                    <input
                      value={userAId}
                      onChange={e => setUserAId(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm outline-none focus:border-blue-500"
                    />
                  </div>
                  <LangSelect value={langA} onChange={setLangA} label="Language A" />
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-gray-400 uppercase tracking-wide block mb-1">User B ID</label>
                    <input
                      value={userBId}
                      onChange={e => setUserBId(e.target.value)}
                      className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-sm outline-none focus:border-blue-500"
                    />
                  </div>
                  <LangSelect value={langB} onChange={setLangB} label="Language B" />
                </div>
              </div>
              <button
                onClick={setProfiles}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                Set Profiles
              </button>
              {profileMsg && (
                <p className={`mt-2 text-sm ${profileMsg.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
                  {profileMsg}
                </p>
              )}
            </div>

            {/* Start Session */}
            <div className="bg-gray-800 rounded-2xl p-5 border border-gray-700">
              <h2 className="text-lg font-semibold mb-3">2. Start Bridge Session</h2>
              <div className="flex gap-3 items-center">
                <button
                  onClick={startSession}
                  disabled={!!sessionId}
                  className="bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium"
                >
                  {sessionId ? 'Session Active' : 'Start Session'}
                </button>
                {sessionId && (
                  <button
                    onClick={closeSession}
                    className="bg-red-700 hover:bg-red-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
                  >
                    Close Session
                  </button>
                )}
              </div>
              {sessionStatus && (
                <p className="mt-2 text-sm text-gray-400 font-mono">{sessionStatus}</p>
              )}
              {sessionId && (
                <p className="mt-1 text-xs text-blue-400 font-mono">ID: {sessionId}</p>
              )}
            </div>

            {/* Chat */}
            {sessionId && (
              <div className="bg-gray-800 rounded-2xl p-5 border border-gray-700">
                <h2 className="text-lg font-semibold mb-3">3. Live Multilingual Session</h2>

                {/* Message list */}
                <div className="bg-gray-900 rounded-xl p-4 h-72 overflow-y-auto mb-4">
                  {messages.length === 0 && (
                    <p className="text-gray-500 text-sm text-center mt-8">
                      No messages yet. Send something!
                    </p>
                  )}
                  {messages.map((m, i) => (
                    <MessageBubble key={i} msg={m} isOwn={m.isOwn} />
                  ))}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input row A */}
                <div className="flex gap-2 mb-2">
                  <span className="text-xs text-gray-400 self-center w-20 shrink-0">
                    {FLAG[langA]} {userAId}
                  </span>
                  <input
                    dir={RTL_LANGS.has(langA) ? 'rtl' : 'ltr'}
                    value={inputA}
                    onChange={e => setInputA(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendMessage(userAId, inputA, setInputA)}
                    placeholder={`Write in ${LANG_NAMES[langA]}…`}
                    className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                    disabled={sending}
                  />
                  <button
                    onClick={() => sendMessage(userAId, inputA, setInputA)}
                    disabled={sending || !inputA.trim()}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-sm"
                  >
                    Send
                  </button>
                </div>

                {/* Input row B */}
                <div className="flex gap-2">
                  <span className="text-xs text-gray-400 self-center w-20 shrink-0">
                    {FLAG[langB]} {userBId}
                  </span>
                  <input
                    dir={RTL_LANGS.has(langB) ? 'rtl' : 'ltr'}
                    value={inputB}
                    onChange={e => setInputB(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendMessage(userBId, inputB, setInputB)}
                    placeholder={`Write in ${LANG_NAMES[langB]}…`}
                    className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500"
                    disabled={sending}
                  />
                  <button
                    onClick={() => sendMessage(userBId, inputB, setInputB)}
                    disabled={sending || !inputB.trim()}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-sm"
                  >
                    Send
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── LEADERBOARD TAB ─────────────────────────────────────────────── */}
        {tab === 'leaderboard' && (
          <div className="bg-gray-800 rounded-2xl p-5 border border-gray-700">
            <h2 className="text-lg font-semibold mb-4">🏆 Top Multilingual Contributors</h2>
            {loadingBoard ? (
              <p className="text-gray-400 text-sm">Loading…</p>
            ) : leaderboard.length === 0 ? (
              <p className="text-gray-500 text-sm">No contributors yet. Start bridging to earn rewards!</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-left border-b border-gray-700">
                    <th className="pb-2">#</th>
                    <th className="pb-2">User</th>
                    <th className="pb-2">Sessions</th>
                    <th className="pb-2">Impact</th>
                    <th className="pb-2">Bonus (μ¢)</th>
                    <th className="pb-2">Badges</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((entry, i) => (
                    <tr key={entry.userId} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-2 text-gray-400">{i + 1}</td>
                      <td className="py-2 font-mono text-blue-300">{entry.userId}</td>
                      <td className="py-2">{entry.totalSessions}</td>
                      <td className="py-2">{entry.impactScore?.toFixed(1)}</td>
                      <td className="py-2">{String(entry.totalBonusMicro ?? 0)}</td>
                      <td className="py-2">
                        {(entry.badges || []).map(b => (
                          <span key={b} className="mr-1 text-xs bg-yellow-700/40 text-yellow-300 px-1.5 py-0.5 rounded">
                            {b}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── STATS TAB ───────────────────────────────────────────────────── */}
        {tab === 'stats' && (
          <div className="space-y-4">
            {!bridgeStats ? (
              <p className="text-gray-400 text-sm">Loading stats…</p>
            ) : (
              <>
                <div className="bg-gray-800 rounded-2xl p-5 border border-gray-700">
                  <h2 className="text-lg font-semibold mb-3">Bridge Network</h2>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-2xl font-bold text-blue-400">{bridgeStats.bridge?.totalSessions ?? 0}</p>
                      <p className="text-xs text-gray-400 mt-1">Total Sessions</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-green-400">{bridgeStats.bridge?.activeSessions ?? 0}</p>
                      <p className="text-xs text-gray-400 mt-1">Active Sessions</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-yellow-400">{bridgeStats.bridge?.totalBridgedMessages ?? 0}</p>
                      <p className="text-xs text-gray-400 mt-1">Bridged Messages</p>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-800 rounded-2xl p-5 border border-gray-700">
                  <h2 className="text-lg font-semibold mb-3">Router</h2>
                  <pre className="text-xs text-gray-300 bg-gray-900 rounded-lg p-3 overflow-auto">
                    {JSON.stringify(bridgeStats.router, null, 2)}
                  </pre>
                </div>

                <div className="bg-gray-800 rounded-2xl p-5 border border-gray-700">
                  <h2 className="text-lg font-semibold mb-3">Supported Languages ({bridgeStats.supportedLanguages?.length ?? 20})</h2>
                  <div className="flex flex-wrap gap-2">
                    {(bridgeStats.supportedLanguages || Object.keys(LANG_NAMES)).map(code => (
                      <span key={code} className={`text-xs px-2 py-1 rounded ${RTL_LANGS.has(code) ? 'bg-purple-800/50 text-purple-200' : 'bg-gray-700 text-gray-300'}`}>
                        {FLAG[code]} {LANG_NAMES[code] || code}
                        {RTL_LANGS.has(code) && <span className="ml-1 text-purple-400">RTL</span>}
                      </span>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
