/**
 * ECOS Session — V37
 * ─────────────────────────────────────────────────────────────────────────────
 * React context + localStorage for session persistence.
 *
 * Stores:
 *   sessionId            — nanoid-style unique ID per browser session
 *   history              — last 100 missions (array of mission records)
 *   conversationHistory  — last 20 chat messages (array of {role, text, ts})
 *   totalSpentUsd        — cumulative USD spent this session (string, 2 dp)
 *   validatorId          — active validator account ID (for quick-access link)
 *   sessionStart         — ISO timestamp of session start
 *
 * Hook: useSession()
 *
 * On first load: if no session in localStorage, generate one.
 */

'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

// ── nanoid-style ID generator (no external dep) ─────────────────────────────
function genId(len = 21) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => chars[b % chars.length]).join('');
}

const STORAGE_KEY = 'ecos_session_v37';
const MAX_HISTORY = 100;
const MAX_CONVERSATION = 20;

const DEFAULT_VALIDATOR_ID = 'validator::demo_001';

// ── Context ──────────────────────────────────────────────────────────────────
const SessionContext = createContext(null);

// ── Provider ─────────────────────────────────────────────────────────────────
export function SessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loaded, setLoaded]   = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    let stored = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch (_) { /* ignore */ }

    // Task 2 - Auto Identity logic
    let uid = null;
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        uid = sessionStorage.getItem('ecos_uid') || (() => {
          const id = crypto.randomUUID();
          sessionStorage.setItem('ecos_uid', id);
          return id;
        })();
      }
    } catch (_) {}

    if (stored && stored.sessionId) {
      if (uid) {
        stored.validatorId = uid;
      }
      setSession(stored);
    } else {
      const fresh = {
        sessionId:           genId(),
        history:             [],
        conversationHistory: [],
        totalSpentUsd:       '0.00',
        validatorId:         uid || DEFAULT_VALIDATOR_ID,
        sessionStart:        new Date().toISOString(),
        isNew:               true,
      };
      setSession(fresh);
    }
    setLoaded(true);
  }, []);

  // Persist to localStorage whenever session changes
  useEffect(() => {
    if (session) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      } catch (_) { /* quota exceeded — ignore */ }
    }
  }, [session]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  /** Add a mission record to history and accumulate spend */
  const addMission = useCallback((record) => {
    setSession(prev => {
      const history = [record, ...(prev.history || [])].slice(0, MAX_HISTORY);
      const prevSpent = parseFloat(prev.totalSpentUsd) || 0;
      const addSpent  = parseFloat(record.amountUsd)   || 0;
      const totalSpentUsd = (prevSpent + addSpent).toFixed(2);
      return { ...prev, history, totalSpentUsd };
    });
  }, []);

  /** Update the active validator ID */
  const setValidatorId = useCallback((id) => {
    setSession(prev => ({ ...prev, validatorId: id || DEFAULT_VALIDATOR_ID }));
  }, []);

  /** Mark the session as no longer "new" (welcome shown) */
  const markWelcomeSeen = useCallback(() => {
    setSession(prev => ({ ...prev, isNew: false }));
  }, []);

  /** Add a message to conversation history */
  const addConversationMessage = useCallback((role, text) => {
    setSession(prev => {
      const msg = { role, text, ts: new Date().toISOString() };
      const conversationHistory = [msg, ...(prev.conversationHistory || [])].slice(0, MAX_CONVERSATION);
      return { ...prev, conversationHistory };
    });
  }, []);

  /** Clear session and start fresh */
  const resetSession = useCallback(() => {
    let uid = null;
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        uid = sessionStorage.getItem('ecos_uid') || (() => {
          const id = crypto.randomUUID();
          sessionStorage.setItem('ecos_uid', id);
          return id;
        })();
      }
    } catch (_) {}

    const fresh = {
      sessionId:           genId(),
      history:             [],
      conversationHistory: [],
      totalSpentUsd:       '0.00',
      validatorId:         uid || DEFAULT_VALIDATOR_ID,
      sessionStart:        new Date().toISOString(),
      isNew:               true,
    };
    setSession(fresh);
  }, []);

  const value = {
    session,
    loaded,
    addMission,
    setValidatorId,
    markWelcomeSeen,
    addConversationMessage,
    resetSession,
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
