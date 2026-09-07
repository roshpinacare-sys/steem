/**
 * frontend/component-primitives/input.ts
 *
 * Input primitive — five types × six states.
 * Focus state tightens the border to the accent ring colour.
 * Error state adds aria-invalid + aria-describedby without overriding state classes.
 * Zero runtime dependencies.
 */

import type { InputSpec, InputType, ComponentState } from "./types.ts";
import { ALL_STATES } from "./types.ts";

const BASE_CLASS = "tfa-input";

const STATE_CLASSES: Record<ComponentState, string> = {
  hover:    "tfa-input--hover",
  focus:    "tfa-input--focus",
  active:   "tfa-input--active",
  disabled: "tfa-input--disabled",
  loading:  "tfa-input--loading",
  empty:    "tfa-input--empty",
};

const BASE_CSS: Record<string, string> = {
  "--input-bg":          "oklch(0.99 0.004 225)",
  "--input-border":      "oklch(0.75 0.009 225)",
  "--input-fg":          "oklch(0.20 0.010 240)",
  "--input-focus-ring":  "oklch(0.54 0.140 221)",
  "--input-error-color": "oklch(0.58 0.200 25)",
  "--input-placeholder": "oklch(0.60 0.010 225)",
};

const VALID_TYPES: readonly InputType[] = [
  "text", "email", "password", "number", "search",
];

export interface BuildInputOptions {
  type: InputType;
  label: string;
  state?: ComponentState;
  helpText?: string;
  errorMessage?: string;
}

/**
 * Build a fully-specified InputSpec for one state.
 * Fail-closed: throws on null opts, missing/unknown type, blank label, or unknown state.
 */
export function buildInput(opts: BuildInputOptions): InputSpec {
  if (opts == null || typeof opts !== "object") {
    throw new Error("buildInput: opts must be an object");
  }
  if (!opts.type) {
    throw new Error("buildInput: type is required");
  }
  if (!(VALID_TYPES as readonly string[]).includes(opts.type)) {
    throw new Error(`buildInput: unknown type "${opts.type}"`);
  }
  if (!opts.label || typeof opts.label !== "string" || opts.label.trim() === "") {
    throw new Error("buildInput: label must be a non-empty string");
  }

  const state: ComponentState = opts.state ?? "hover";
  if (!(ALL_STATES as readonly string[]).includes(state)) {
    throw new Error(`buildInput: unknown state "${state}"`);
  }

  const classes: string[] = [BASE_CLASS, STATE_CLASSES[state]];
  if (opts.errorMessage) classes.push("tfa-input--error");

  const ariaAttrs: Record<string, string> = {};
  if (state === "disabled") ariaAttrs["aria-disabled"] = "true";
  if (state === "loading")  ariaAttrs["aria-busy"]     = "true";
  if (opts.errorMessage) {
    ariaAttrs["aria-invalid"]     = "true";
    ariaAttrs["aria-describedby"] = "input-error";
  }

  // Focus state: pull border colour to the accent ring.
  // Efficiency: copy once, mutate the single key — no extra object creation.
  const cssVars: Record<string, string> = { ...BASE_CSS };
  if (state === "focus") {
    cssVars["--input-border"] = cssVars["--input-focus-ring"];
  }

  return {
    type: opts.type,
    label: opts.label,
    state,
    classes,
    ariaAttrs,
    cssVars,
    ...(opts.helpText     !== undefined ? { helpText:     opts.helpText }     : {}),
    ...(opts.errorMessage !== undefined ? { errorMessage: opts.errorMessage } : {}),
  };
}

/**
 * Return one InputSpec per ComponentState — the canonical six-state kit.
 */
export function buildInputKit(type: InputType, label: string): InputSpec[] {
  if (!type) throw new Error("buildInputKit: type is required");
  if (!label || typeof label !== "string" || label.trim() === "") {
    throw new Error("buildInputKit: label must be a non-empty string");
  }
  return ALL_STATES.map(state => buildInput({ type, label, state }));
}
