"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Store - הקשר נתונים משותף לכל הטאבים.
//
// שני מצבי אמת (החלטה ארכיטקטונית אחרי מות-הסנדבוקס השלישי):
//  · cloud (ברירת מחדל) - הספר החי מהענן: mirror.json דרך /api/live/*.
//    הסנדבוקס ימות מתי שימות - האתר ימשיך להראות את האמת הפועמת.
//  · local - עותק הסנדבוקס: SQLite מקומי עם מלוא הפעולות האינטראקטיביות
//    (אימות חדש, ערעור מדומה, צ'קפוינט) - מרחב טסט מסומן בבירור.
// פעולות כתיבה תמיד נוגעות בעותק המקומי בלבד - הענן כותב בעצמו
// דרך סוכניו (ראה אזור האדמין: מרכז הפיקוד).
// ─────────────────────────────────────────────────────────────────────

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AgentDTO,
  AttestationDTO,
  CheckpointDTO,
  RepoDTO,
  StageDTO,
  VerifyReportDTO,
  WeaveStateDTO,
} from "@/lib/weave/types";
import { apiFetch, errorMessage } from "./api";

export type DataMode = "cloud" | "local";

// ── DTOs של השכבה החיה ─────────────────────────────────────────────

export interface LiveOverview {
  source: "cloud-mirror";
  mirrorGeneratedAt: string;
  stats: {
    attestations: number;
    checkpoints: number;
    agents: number;
    brainKeys: number;
    brainLive: number;
    attByStatus: Record<string, number>;
    headHash: string;
  };
  vitality: {
    atts24h: number;
    atts7d: number;
    signers24h: number | null;
    checkpoints24h: number;
    marketEvents24h: number | null;
    lastAttAgeMin: number;
    aliveDays: number;
    /** R119 · false = קנון מהספר המלא · true = חלון-מראה בלבד (מתויג בתצוגה) */
    windowLimited: boolean;
    computedAtIso?: string | null;
  };
  freshness: { verdict: string; ageHours: number; thresholdHours: number; cadence: string } | null;
  witness: {
    account: string;
    txid: string;
    block: number;
    explorer: string;
    at: string;
    checkpoint: number;
    root: string;
    commit: string;
  } | null;
  brain: Array<{ fingerprint: string; status: string; lastCode: string; verifiedAt: string }>;
  anchorLines: { steem: number; zero: number };
  marketEvents: Array<{ seq: number; kind: string; at: string; summary: string }>;
  agents: Array<{
    name: string;
    role: string;
    status: string;
    address: string;
    attestations: number;
    lastAttestationSeq: number | null;
    lastAttestationAt: string | null;
  }>;
  recentAttestations: Array<{
    seq: number;
    type: string;
    status: string;
    at: string;
    agentName: string;
    claim: string;
  }>;
  lastCheckpoint: { index: number; root: string; attFrom: number; attTo: number; at: string; anchoredOn: string[] } | null;
  loop: {
    coverage: {
      withAgents: number;
      total: number;
      idle: number;
      agents: number;
      // r140 — חלוקת-אמת ברמת-הסוכן (agents-watch): לא מספיק "ריפו מכוסה"
      byState?: { live: number; degraded: number; dormant: number } | null;
    } | null;
    requests: { delivered: number; total: number } | null;
    standingOrders: number | null;
    verify: { total: number; passed: number; failed: number; verdict: string } | null;
    checkpoints: number;
  } | null;
}

export interface RegistryAgentDTO {
  id: string;
  name: string;
  repo: string;
  visibility: string;
  schedule: string;
  layer: string;
  role: { en: string; he: string };
  input: { en: string; he: string };
  output: { en: string; he: string };
  state: string;
  stats?: {
    runs_sampled: number;
    success: number;
    failure: number;
    other: number;
    successRate: number;
    avgDurS: number;
  };
  lastRun?: { at: string; conclusion: string };
}

export interface RegistryDTO {
  generatedAt: string;
  reposTotal: number;
  reposWithAgents: string[];
  reposIdle: string[];
  agents: RegistryAgentDTO[];
}

export interface Slice<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface TamperResult {
  seq: number;
  field: string;
  before: string;
  after: string;
}

export interface AttestInput {
  agentId: string;
  claim: string;
  claimType: string;
  evidence: string;
}

export interface RegisterAgentInput {
  name: string;
  role: string;
}

export interface CloseStageInput {
  code: string;
  attestationSeq: number;
}

interface WeaveContextValue {
  mode: DataMode;
  setMode: (m: DataMode) => void;
  state: Slice<WeaveStateDTO>;
  attestations: Slice<AttestationDTO[]>;
  attTotal: number;
  agents: Slice<AgentDTO[]>;
  checkpoints: Slice<CheckpointDTO[]>;
  repos: Slice<RepoDTO[]>;
  stages: Slice<StageDTO[]>;
  report: Slice<VerifyReportDTO>;
  live: Slice<LiveOverview>;
  registry: Slice<RegistryDTO>;
  loadState: () => void;
  reloadState: () => void;
  loadAttestations: () => void;
  reloadAttestations: () => void;
  loadAgents: () => void;
  reloadAgents: () => void;
  loadCheckpoints: () => void;
  reloadCheckpoints: () => void;
  loadRepos: () => void;
  loadStages: () => void;
  loadLive: () => void;
  loadRegistry: () => void;
  runVerify: () => Promise<VerifyReportDTO>;
  attest: (input: AttestInput) => Promise<AttestationDTO>;
  tamper: (input?: { seq?: number; field?: string }) => Promise<TamperResult>;
  createCheckpoint: () => Promise<CheckpointDTO>;
  registerAgent: (input: RegisterAgentInput) => Promise<AgentDTO>;
  closeStage: (input: CloseStageInput) => Promise<StageDTO>;
}

const WeaveContext = createContext<WeaveContextValue | null>(null);

// ── מיפוי המראה <- DTO מקומי (צורה תואמת, מקור מסומן) ────────────────

function liveStateFromOverview(o: LiveOverview): WeaveStateDTO {
  const lastCp = o.lastCheckpoint;
  return {
    chainCount: o.stats.attestations,
    headHash: o.stats.headHash,
    agents: o.stats.agents,
    checkpoints: o.stats.checkpoints,
    lastRoot: lastCp?.root ?? null,
    lastAnchorStatus:
      lastCp && lastCp.anchoredOn && lastCp.anchoredOn.length > 0
        ? `ANCHORED (${lastCp.anchoredOn.join("+")})`
        : "LOCAL",
    stats: o.stats.attByStatus,
    networkAddress: null,
    vitality: {
      atts24h: o.vitality.atts24h,
      atts7d: o.vitality.atts7d,
      // R119 · אפס מומצא מת — ערך לא-ידוע מוצג כ-null ("—"), לא כ-0 שקרי
      signers24h: o.vitality.signers24h ?? null,
      checkpoints24h: o.vitality.checkpoints24h,
      marketEvents24h: o.vitality.marketEvents24h ?? null,
      aliveDays: o.vitality.aliveDays,
      lastAttAgeMin: o.vitality.lastAttAgeMin,
      computedAtIso: o.vitality.computedAtIso ?? o.mirrorGeneratedAt,
      // המשכיות חוק-R119 לצרכן המפושט: התווית זורמת עם הנתונים
      windowLimited: o.vitality.windowLimited,
    },
  };
}

function liveAgentsFromOverview(o: LiveOverview): AgentDTO[] {
  return o.agents.map((a) => ({
    id: a.name,
    name: a.name,
    role: a.role,
    ethAddress: a.address,
    pubKeyHex: "",
    status: a.status,
    // מראת-ענן: אין מפתחות בסביבה זו — הזהויות לצפייה בלבד (הגדרת r117)
    capability: "IDENTITY-ONLY" as const,
    attCount: a.attestations,
    createdAt: a.lastAttestationAt ?? "",
  }));
}

// ── fetchers ברמת המודול (זהות יציבה עבור useCallback) ──────────────

const fetchLocalState = () =>
  apiFetch<{ state: WeaveStateDTO }>("/api/weave/state").then((r) => r.state);

const fetchLocalAttestations = () =>
  apiFetch<{ total: number; entries: AttestationDTO[] }>(
    "/api/weave/attestations?limit=200"
  );

const fetchLocalAgents = () =>
  apiFetch<{ agents: AgentDTO[] }>("/api/agents").then((r) => r.agents);

const fetchLocalCheckpoints = () =>
  apiFetch<{ checkpoints: CheckpointDTO[] }>("/api/weave/checkpoints").then(
    (r) => r.checkpoints
  );

const fetchRepos = () =>
  apiFetch<{ repos: RepoDTO[] }>("/api/ecosystem").then((r) => r.repos);

const fetchStages = () =>
  apiFetch<{ stages: StageDTO[] }>("/api/plan").then((r) => r.stages);

const fetchLiveAttestations = () =>
  apiFetch<{ total: number; entries: AttestationDTO[] }>(
    "/api/live/attestations?limit=200"
  );

const fetchLiveCheckpoints = () =>
  apiFetch<{ entries: CheckpointDTO[] }>("/api/live/checkpoints?limit=50").then(
    (r) => r.entries
  );

// ── useSlice: טעינה חד-פעמית + רענון כפוי, עם הגנה מפני קריאות מקבילות ──

function useSlice<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [slice, setSlice] = useState<Slice<T>>({
    data: null,
    loading: false,
    error: null,
  });
  const startedRef = useRef("");
  const inFlightRef = useRef(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const depsKey = JSON.stringify(deps);

  const load = useCallback(
    async (force: boolean) => {
      if (inFlightRef.current) return;
      if (!force && startedRef.current === depsKey) return;
      startedRef.current = depsKey;
      inFlightRef.current = true;
      setSlice((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await fetcherRef.current();
        setSlice({ data, loading: false, error: null });
      } catch (err) {
        setSlice({ data: null, loading: false, error: errorMessage(err) });
      } finally {
        inFlightRef.current = false;
      }
    },
    [depsKey]
  );

  const loadLazy = useCallback(() => {
    void load(false);
  }, [load]);

  const reload = useCallback(() => {
    void load(true);
  }, [load]);

  return { slice, loadLazy, reload };
}

export function WeaveProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<DataMode>("cloud");

  // ── השכבה החיה (תמיד נטענת - היא האמת הפומבית של האתר) ────────────
  const { slice: liveSlice, loadLazy: loadLive, reload: reloadLiveRaw } =
    useSlice(() =>
      apiFetch<{ live: LiveOverview; registry: RegistryDTO | null }>("/api/live/overview")
    );
  const live: Slice<LiveOverview> = {
    data: liveSlice.data?.live ?? null,
    loading: liveSlice.loading,
    error: liveSlice.error,
  };
  const registry: Slice<RegistryDTO> = {
    data: liveSlice.data?.registry ?? null,
    loading: liveSlice.loading,
    error: liveSlice.error,
  };
  const loadRegistry = loadLive;

  // רענון אוטומטי של האמת החיה כל 5 דקות - האתר נושם עם הענן
  useEffect(() => {
    // R119 · ההערה למעלה אומרת "תמיד נטענת" — עכשיו זה נכון גם בטעינה הראשונה
    // (לפני: רק אינטרוול 5-דקות או ביקור בעמוד הבית מילאו את השכבה)
    loadLive();
    const t = setInterval(() => void reloadLiveRaw(), 5 * 60_000);
    return () => clearInterval(t);
  }, [loadLive, reloadLiveRaw]);

  // ── פרוסות מודעות-מצב ─────────────────────────────────────────────
  const liveData = live.data;

  const fetchState = useCallback(() => {
    if (mode === "cloud" && liveData) return Promise.resolve(liveStateFromOverview(liveData));
    if (mode === "cloud") {
      // עדיין אין סקירה חיה - נסה למשוך, ואם הענן מת נפול בכנות למקומי
      return apiFetch<{ live: LiveOverview }>("/api/live/overview")
        .then((r) => liveStateFromOverview(r.live))
        .catch(() => fetchLocalState());
    }
    return fetchLocalState();
  }, [mode, liveData]);

  const fetchAttestations = useCallback(() => {
    if (mode === "cloud") {
      return fetchLiveAttestations().catch(() => fetchLocalAttestations());
    }
    return fetchLocalAttestations();
  }, [mode]);

  const fetchAgents = useCallback(() => {
    if (mode === "cloud") {
      if (liveData) return Promise.resolve(liveAgentsFromOverview(liveData));
      return apiFetch<{ live: LiveOverview }>("/api/live/overview")
        .then((r) => liveAgentsFromOverview(r.live))
        .catch(() => fetchLocalAgents());
    }
    return fetchLocalAgents();
  }, [mode, liveData]);

  const fetchCheckpoints = useCallback(() => {
    if (mode === "cloud") {
      return fetchLiveCheckpoints().catch(() => fetchLocalCheckpoints());
    }
    return fetchLocalCheckpoints();
  }, [mode]);

  const { slice: stateSlice, loadLazy: loadState, reload: reloadState } = useSlice(fetchState, [mode, liveData]);
  const { slice: attSlice, loadLazy: loadAttestations, reload: reloadAttestations } =
    useSlice(fetchAttestations, [mode]);
  const { slice: agentsSlice, loadLazy: loadAgents, reload: reloadAgents } = useSlice(fetchAgents, [mode, liveData]);
  const { slice: checkpointsSlice, loadLazy: loadCheckpoints, reload: reloadCheckpoints } =
    useSlice(fetchCheckpoints, [mode]);
  const { slice: reposSlice, loadLazy: loadRepos } = useSlice(fetchRepos);
  const { slice: stagesSlice, loadLazy: loadStages, reload: reloadStages } =
    useSlice(fetchStages);

  // ── אימות שרשרת (חישוב-מחדש - מקומי בהגדרה; בענן הלב מאמת בכל פעימה) ──
  const [report, setReport] = useState<VerifyReportDTO | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const verifyPromiseRef = useRef<Promise<VerifyReportDTO> | null>(null);

  const runVerify = useCallback((): Promise<VerifyReportDTO> => {
    if (verifyPromiseRef.current) return verifyPromiseRef.current;
    const promise = (async () => {
      setVerifying(true);
      setVerifyError(null);
      try {
        const res = await apiFetch<{ report: VerifyReportDTO }>("/api/weave/verify", {
          method: "POST",
        });
        setReport(res.report);
        return res.report;
      } catch (err) {
        setVerifyError(errorMessage(err));
        throw err;
      } finally {
        setVerifying(false);
        verifyPromiseRef.current = null;
      }
    })();
    verifyPromiseRef.current = promise;
    return promise;
  }, []);

  // ── פעולות (תמיד על העותק המקומי - הענן כותב רק דרך סוכניו) ───────

  const attest = useCallback(
    async (input: AttestInput) => {
      const res = await apiFetch<{ entry: AttestationDTO }>("/api/weave/attest", {
        method: "POST",
        body: JSON.stringify(input),
      });
      reloadAttestations();
      reloadState();
      return res.entry;
    },
    [reloadAttestations, reloadState]
  );

  const tamper = useCallback(
    async (input?: { seq?: number; field?: string }) => {
      const res = await apiFetch<TamperResult>("/api/weave/tamper", {
        method: "POST",
        body: JSON.stringify(input ?? {}),
      });
      reloadAttestations();
      reloadState();
      return res;
    },
    [reloadAttestations, reloadState]
  );

  const createCheckpoint = useCallback(async () => {
    const res = await apiFetch<{ checkpoint: CheckpointDTO }>(
      "/api/weave/checkpoint",
      { method: "POST" }
    );
    reloadCheckpoints();
    reloadState();
    return res.checkpoint;
  }, [reloadCheckpoints, reloadState]);

  const registerAgent = useCallback(
    async (input: RegisterAgentInput) => {
      const res = await apiFetch<{ agent: AgentDTO }>("/api/agents", {
        method: "POST",
        body: JSON.stringify(input),
      });
      reloadAgents();
      reloadState();
      return res.agent;
    },
    [reloadAgents, reloadState]
  );

  const closeStage = useCallback(
    async (input: CloseStageInput) => {
      const res = await apiFetch<{ stage: StageDTO }>("/api/plan/close", {
        method: "POST",
        body: JSON.stringify(input),
      });
      void reloadStages();
      return res.stage;
    },
    [reloadStages]
  );

  const handleSetMode = useCallback(
    (m: DataMode) => {
      setMode(m);
    },
    []
  );

  const value = useMemo<WeaveContextValue>(() => {
    const attData = attSlice.data;
    return {
      mode,
      setMode: handleSetMode,
      state: stateSlice,
      attestations: {
        data: attData ? attData.entries : null,
        loading: attSlice.loading,
        error: attSlice.error,
      },
      attTotal: attData ? attData.total : 0,
      agents: agentsSlice,
      checkpoints: checkpointsSlice,
      repos: reposSlice,
      stages: stagesSlice,
      report: { data: report, loading: verifying, error: verifyError },
      live,
      registry,
      loadState,
      reloadState,
      loadAttestations,
      reloadAttestations,
      loadAgents,
      reloadAgents,
      loadCheckpoints,
      reloadCheckpoints,
      loadRepos,
      loadStages,
      loadLive,
      loadRegistry,
      runVerify,
      attest,
      tamper,
      createCheckpoint,
      registerAgent,
      closeStage,
    };
  }, [
    mode,
    handleSetMode,
    stateSlice,
    attSlice,
    agentsSlice,
    checkpointsSlice,
    reposSlice,
    stagesSlice,
    live,
    registry,
    loadState,
    reloadState,
    loadAttestations,
    reloadAttestations,
    loadAgents,
    reloadAgents,
    loadCheckpoints,
    reloadCheckpoints,
    loadRepos,
    loadStages,
    loadLive,
    loadRegistry,
    runVerify,
    attest,
    tamper,
    createCheckpoint,
    registerAgent,
    closeStage,
  ]);

  return <WeaveContext.Provider value={value}>{children}</WeaveContext.Provider>;
}

export function useWeave(): WeaveContextValue {
  const ctx = useContext(WeaveContext);
  if (!ctx) {
    throw new Error("useWeave must be used within WeaveProvider");
  }
  return ctx;
}
