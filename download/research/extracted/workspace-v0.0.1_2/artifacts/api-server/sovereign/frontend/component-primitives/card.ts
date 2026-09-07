/**
 * frontend/component-primitives/card.ts
 *
 * Card primitive — four kinds × six states, with optional verdict overlay.
 * Verdict colours (valid/invalid/pending) are semantic — used ONLY for trust/decision meaning.
 * Zero runtime dependencies.
 */

import type { CardSpec, CardKind, ComponentState, VerdictKind } from "./types.ts";
import { ALL_STATES } from "./types.ts";

const BASE_CLASS = "tfa-card";

const KIND_CLASSES: Record<CardKind, string> = {
  default:  "tfa-card--default",
  elevated: "tfa-card--elevated",
  outlined: "tfa-card--outlined",
  verdict:  "tfa-card--verdict",
};

const STATE_CLASSES: Record<ComponentState, string> = {
  hover:    "tfa-card--hover",
  focus:    "tfa-card--focus",
  active:   "tfa-card--active",
  disabled: "tfa-card--disabled",
  loading:  "tfa-card--loading",
  empty:    "tfa-card--empty",
};

// Base OKLCH surface tokens for all card kinds.
const BASE_CSS: Record<string, string> = {
  "--card-bg":           "oklch(0.99 0.004 225)",
  "--card-border":       "oklch(0.86 0.008 225)",
  "--card-shadow":       "oklch(0.20 0.010 240 / 0.08)",
  "--card-title-fg":     "oklch(0.20 0.010 240)",
  "--card-body-fg":      "oklch(0.45 0.011 225)",
  "--card-hover-border": "oklch(0.54 0.140 221)",
};

// Semantic verdict overlays — OKLCH only, no hex.
// green=valid, red=invalid, amber=pending.
const VERDICT_CSS: Record<VerdictKind, Record<string, string>> = {
  valid: {
    "--card-accent":    "oklch(0.62 0.160 150)",
    "--card-accent-fg": "oklch(0.97 0.006 225)",
  },
  invalid: {
    "--card-accent":    "oklch(0.58 0.200 25)",
    "--card-accent-fg": "oklch(0.97 0.006 225)",
  },
  pending: {
    "--card-accent":    "oklch(0.72 0.150 75)",
    "--card-accent-fg": "oklch(0.20 0.010 240)",
  },
};

const VALID_KINDS: readonly CardKind[] = [
  "default", "elevated", "outlined", "verdict",
];
const VALID_VERDICTS: readonly VerdictKind[] = ["valid", "invalid", "pending"];

export interface BuildCardOptions {
  kind: CardKind;
  title: string;
  state?: ComponentState;
  body?: string;
  verdict?: VerdictKind;
}

/**
 * Build a fully-specified CardSpec for one state.
 * Fail-closed: throws on null opts, missing/unknown kind, blank title,
 * unknown state, or unknown verdict value.
 */
export function buildCard(opts: BuildCardOptions): CardSpec {
  if (opts == null || typeof opts !== "object") {
    throw new Error("buildCard: opts must be an object");
  }
  if (!opts.kind) {
    throw new Error("buildCard: kind is required");
  }
  if (!(VALID_KINDS as readonly string[]).includes(opts.kind)) {
    throw new Error(`buildCard: unknown kind "${opts.kind}"`);
  }
  if (!opts.title || typeof opts.title !== "string" || opts.title.trim() === "") {
    throw new Error("buildCard: title must be a non-empty string");
  }
  if (opts.verdict !== undefined && !(VALID_VERDICTS as readonly string[]).includes(opts.verdict)) {
    throw new Error(`buildCard: unknown verdict "${opts.verdict}"`);
  }

  const state: ComponentState = opts.state ?? "hover";
  if (!(ALL_STATES as readonly string[]).includes(state)) {
    throw new Error(`buildCard: unknown state "${state}"`);
  }

  const classes: string[] = [BASE_CLASS, KIND_CLASSES[opts.kind], STATE_CLASSES[state]];

  const ariaAttrs: Record<string, string> = {};
  if (state === "disabled") ariaAttrs["aria-disabled"] = "true";
  if (state === "loading")  ariaAttrs["aria-busy"]     = "true";

  // Efficiency: spread base once; conditionally merge verdict overlay.
  const cssVars: Record<string, string> = { ...BASE_CSS };
  if (opts.verdict !== undefined) {
    Object.assign(cssVars, VERDICT_CSS[opts.verdict]);
  }

  return {
    kind: opts.kind,
    state,
    title: opts.title,
    classes,
    ariaAttrs,
    cssVars,
    ...(opts.body    !== undefined ? { body:    opts.body }    : {}),
    ...(opts.verdict !== undefined ? { verdict: opts.verdict } : {}),
  };
}

/**
 * Return one CardSpec per ComponentState — the canonical six-state kit.
 */
export function buildCardKit(kind: CardKind, title: string): CardSpec[] {
  if (!kind) throw new Error("buildCardKit: kind is required");
  if (!title || typeof title !== "string" || title.trim() === "") {
    throw new Error("buildCardKit: title must be a non-empty string");
  }
  return ALL_STATES.map(state => buildCard({ kind, title, state }));
}
