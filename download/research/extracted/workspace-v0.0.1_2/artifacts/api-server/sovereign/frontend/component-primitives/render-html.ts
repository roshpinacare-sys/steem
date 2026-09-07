/**
 * frontend/component-primitives/render-html.ts
 *
 * Deterministic HTML serializers for Button/Input/Table/Card specs.
 * Pure functions: same spec in → byte-identical markup out, every time.
 * This determinism is what makes the specs snapshot-able — the
 * visual-regression harness diffs this output, not a rendered DOM.
 *
 * Conventions:
 *   - Attributes are emitted in a fixed, sorted order (classes, then
 *     css custom properties via style=, then aria-* sorted, then content).
 *   - No raster, no inline JS, no external resources — markup only.
 *   - Zero runtime dependencies.
 */

import type { ButtonSpec, InputSpec, TableSpec, CardSpec } from "./types.ts";

/** Escape text content / attribute values for safe, deterministic HTML embedding. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Render a cssVars record as a sorted, semicolon-joined inline style="" value. */
function renderStyle(cssVars: Record<string, string>): string {
  const keys = Object.keys(cssVars).sort();
  if (keys.length === 0) return "";
  const decls = keys.map((k) => `${k}:${cssVars[k]}`).join(";");
  return ` style="${escapeHtml(decls)}"`;
}

/** Render ariaAttrs sorted by key for deterministic attribute order. */
function renderAria(ariaAttrs: Record<string, string>): string {
  const keys = Object.keys(ariaAttrs).sort();
  if (keys.length === 0) return "";
  return " " + keys.map((k) => `${k}="${escapeHtml(ariaAttrs[k])}"`).join(" ");
}

function renderClasses(classes: string[]): string {
  // classes are pushed in a fixed order by the builders (base, variant, state) — preserve it.
  return classes.join(" ");
}

// ─── Button ──────────────────────────────────────────────────────────────────

export function renderButtonHtml(spec: ButtonSpec): string {
  const disabled = spec.state === "disabled" || spec.state === "loading" ? " disabled" : "";
  const icon = spec.iconSvg ? spec.iconSvg : "";
  return (
    `<button class="${renderClasses(spec.classes)}"${renderStyle(spec.cssVars)}` +
    `${renderAria(spec.ariaAttrs)}${disabled}>` +
    `${icon}<span class="tfa-btn__label">${escapeHtml(spec.label)}</span></button>`
  );
}

// ─── Input ───────────────────────────────────────────────────────────────────

export function renderInputHtml(spec: InputSpec): string {
  const disabled = spec.state === "disabled" ? " disabled" : "";
  const help = spec.helpText
    ? `<span class="tfa-input__help">${escapeHtml(spec.helpText)}</span>`
    : "";
  const error = spec.errorMessage
    ? `<span class="tfa-input__error">${escapeHtml(spec.errorMessage)}</span>`
    : "";
  return (
    `<label class="tfa-input__label">${escapeHtml(spec.label)}` +
    `<input class="${renderClasses(spec.classes)}" type="${escapeHtml(spec.type)}"` +
    `${renderStyle(spec.cssVars)}${renderAria(spec.ariaAttrs)}${disabled}/>` +
    `</label>${help}${error}`
  );
}

// ─── Table ───────────────────────────────────────────────────────────────────

export function renderTableHtml(spec: TableSpec): string {
  const head = spec.columns
    .map((c) => {
      const sort = c.sortDir && c.sortDir !== "none" ? ` data-sort="${c.sortDir}"` : "";
      const numeric = c.numeric ? ' data-numeric="true"' : "";
      return `<th${sort}${numeric}>${escapeHtml(c.label)}</th>`;
    })
    .join("");

  let body: string;
  if (spec.rows.length === 0) {
    const msg = spec.emptyMessage ?? "No data";
    body = `<tr class="tfa-table__empty-row"><td colspan="${spec.columns.length}">${escapeHtml(msg)}</td></tr>`;
  } else {
    body = spec.rows
      .map((r) => {
        const cells = spec.columns
          .map((c) => `<td>${escapeHtml(String(r.cells[c.key] ?? ""))}</td>`)
          .join("");
        return `<tr data-row-id="${escapeHtml(r.id)}">${cells}</tr>`;
      })
      .join("");
  }

  return (
    `<table class="${renderClasses(spec.classes)}"${renderStyle(spec.cssVars)}${renderAria(spec.ariaAttrs)}>` +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────

export function renderCardHtml(spec: CardSpec): string {
  const verdict = spec.verdict ? ` data-verdict="${escapeHtml(spec.verdict)}"` : "";
  const body = spec.body ? `<p class="tfa-card__body">${escapeHtml(spec.body)}</p>` : "";
  return (
    `<div class="${renderClasses(spec.classes)}"${renderStyle(spec.cssVars)}` +
    `${renderAria(spec.ariaAttrs)}${verdict}>` +
    `<h3 class="tfa-card__title">${escapeHtml(spec.title)}</h3>${body}</div>`
  );
}
