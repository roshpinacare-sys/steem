"use client";

// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · Hook לרישום העוגן המקומי (EVM-2 · LOCAL):
// טוען את ה-roots ש"ירדו" לסימולציית החוזה בשרת (GET /api/weave/registry).
// מורם לרמת הטאב כי הרשימה נחוצה גם לכרטיסי ה-checkpoints (תג רישום #k)
// וגם לסקשן הרישום עצמו: מקור אחד, בלי כפילות בקשות. (דפוס useSlice)
// ─────────────────────────────────────────────────────────────────────

import { useCallback, useRef, useState } from "react";
import type { LocalAnchorDTO } from "@/lib/weave/evmext-types";
import { apiFetch, errorMessage } from "../api";

export interface LocalAnchorsSlice {
  data: LocalAnchorDTO[] | null;
  loading: boolean;
  error: string | null;
}

export function useLocalAnchors() {
  const [slice, setSlice] = useState<LocalAnchorsSlice>({
    data: null,
    loading: false,
    error: null,
  });
  const startedRef = useRef(false);
  const inFlightRef = useRef(false);

  const load = useCallback(async (force: boolean) => {
    if (inFlightRef.current) return;
    if (!force && startedRef.current) return;
    startedRef.current = true;
    inFlightRef.current = true;
    setSlice((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await apiFetch<{ anchors: LocalAnchorDTO[] }>(
        "/api/weave/registry"
      );
      setSlice({ data: res.anchors, loading: false, error: null });
    } catch (err) {
      setSlice((s) => ({ ...s, loading: false, error: errorMessage(err) }));
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const loadLazy = useCallback(() => {
    void load(false);
  }, [load]);

  const reload = useCallback(() => {
    void load(true);
  }, [load]);

  return { slice, loadLazy, reload };
}
