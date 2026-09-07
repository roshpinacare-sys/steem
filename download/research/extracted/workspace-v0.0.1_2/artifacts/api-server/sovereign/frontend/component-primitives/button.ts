/**
 * frontend/component-primitives/button.ts
 *
 * Button primitive — four variants × six states.
 * All colours expressed as OKLCH semantic values (no hex/HSL).
 * Loading state injects an inline SVG spinner (no icon font, no raster).
 * Zero runtime dependencies.
 */

import type { ButtonSpec, ButtonVariant, ComponentState } from "./types.ts";
import { ALL_STATES } from "./types.ts";

// Inline SVG spinner — CSS animation declared in consuming stylesheet.
// aria-hidden so screen readers announce the label, not the spinner markup.
const SPINNER_SVG =
  `<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" ` +
  `fill="none" xmlns="http://www.w3.org/2000/svg">` +
  `<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" ` +
  `stroke-dasharray="28" stroke-dashoffset="10" ` +
  `style="animation:tfa-spin 0.8s linear infinite"/>` +
  `</svg>`;

const BASE_CLASS = "tfa-btn";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:   "tfa-btn--primary",
  secondary: "tfa-btn--secondary",
  ghost:     "tfa-btn--ghost",
  danger:    "tfa-btn--danger",
};

const STATE_CLASSES: Partial<Record<ComponentState, string>> = {
  disabled: "tfa-btn--disabled",
  loading:  "tfa-btn--loading",
};

// OKLCH semantic CSS custom properties per variant.
// Consuming stylesheets apply: background: var(--btn-bg); color: var(--btn-fg); etc.
const VARIANT_CSS: Record<ButtonVariant, Record<string, string>> = {
  primary: {
    "--btn-bg":     "oklch(0.54 0.140 221)",
    "--btn-fg":     "oklch(0.97 0.006 225)",
    "--btn-border": "oklch(0.45 0.130 221)",
  },
  secondary: {
    "--btn-bg":     "oklch(0.93 0.007 225)",
    "--btn-fg":     "oklch(0.20 0.010 240)",
    "--btn-border": "oklch(0.75 0.009 225)",
  },
  ghost: {
    "--btn-bg":     "transparent",
    "--btn-fg":     "oklch(0.54 0.140 221)",
    "--btn-border": "transparent",
  },
  danger: {
    "--btn-bg":     "oklch(0.58 0.200 25)",
    "--btn-fg":     "oklch(0.97 0.006 225)",
    "--btn-border": "oklch(0.50 0.180 25)",
  },
};

const VALID_VARIANTS: readonly ButtonVariant[] = [
  "primary", "secondary", "ghost", "danger",
];

export interface BuildButtonOptions {
  variant: ButtonVariant;
  label: string;
  state?: ComponentState;
  iconSvg?: string;
}

/**
 * Build a fully-specified ButtonSpec for one state.
 * Fail-closed: throws on null opts, missing/unknown variant, blank label, or unknown state.
 */
export function buildButton(opts: BuildButtonOptions): ButtonSpec {
  if (opts == null || typeof opts !== "object") {
    throw new Error("buildButton: opts must be an object");
  }
  if (!opts.variant) {
    throw new Error("buildButton: variant is required");
  }
  if (!(VALID_VARIANTS as readonly string[]).includes(opts.variant)) {
    throw new Error(`buildButton: unknown variant "${opts.variant}"`);
  }
  if (!opts.label || typeof opts.label !== "string" || opts.label.trim() === "") {
    throw new Error("buildButton: label must be a non-empty string");
  }

  const state: ComponentState = opts.state ?? "hover";
  if (!(ALL_STATES as readonly string[]).includes(state)) {
    throw new Error(`buildButton: unknown state "${state}"`);
  }

  const classes: string[] = [BASE_CLASS, VARIANT_CLASSES[opts.variant]];
  const sc = STATE_CLASSES[state];
  if (sc) classes.push(sc);

  const ariaAttrs: Record<string, string> = {};
  if (state === "disabled" || state === "loading") {
    ariaAttrs["aria-disabled"] = "true";
  }
  if (state === "loading") {
    ariaAttrs["aria-busy"] = "true";
  }

  const cssVars: Record<string, string> = { ...VARIANT_CSS[opts.variant] };

  // Loading state overrides explicit iconSvg with the spinner.
  const iconSvg = state === "loading" ? SPINNER_SVG : opts.iconSvg;

  return {
    variant: opts.variant,
    label: opts.label,
    state,
    classes,
    ariaAttrs,
    cssVars,
    ...(iconSvg !== undefined ? { iconSvg } : {}),
  };
}

/**
 * Return one ButtonSpec per ComponentState — the canonical six-state kit.
 * Efficiency: iterates ALL_STATES once; reuses the same variant CSS map per call.
 */
export function buildButtonKit(variant: ButtonVariant, label: string): ButtonSpec[] {
  if (!variant) throw new Error("buildButtonKit: variant is required");
  if (!label || typeof label !== "string" || label.trim() === "") {
    throw new Error("buildButtonKit: label must be a non-empty string");
  }
  return ALL_STATES.map(state => buildButton({ variant, label, state }));
}
