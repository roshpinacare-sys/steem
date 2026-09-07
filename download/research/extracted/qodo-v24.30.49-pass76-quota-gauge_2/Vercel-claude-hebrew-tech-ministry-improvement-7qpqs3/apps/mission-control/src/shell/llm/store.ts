/**
 * llm/store.ts — device-local storage for LLM provider keys and the selected
 * default. Keys live in localStorage (app-private inside the WebView), exactly
 * like the GitHub token. Nothing is ever sent anywhere except the chosen
 * provider's own endpoint.
 */
import { PROVIDERS, type ProviderId } from "./providers.js";

const keyStorageKey = (id: ProviderId) => `qodo:llm:key:${id}`;
const MODEL_KEY = (id: ProviderId) => `qodo:llm:model:${id}`;
const SELECTED_KEY = "qodo:llm:selected";

const listeners = new Set<() => void>();
export function onLlmChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
function notify(): void { for (const l of listeners) l(); }

export function getKey(id: ProviderId): string | null {
  try { return window.localStorage.getItem(keyStorageKey(id)) || null; } catch { return null; }
}

export function setKey(id: ProviderId, key: string): void {
  try {
    if (key.trim()) window.localStorage.setItem(keyStorageKey(id), key.trim());
    else window.localStorage.removeItem(keyStorageKey(id));
  } catch { /* storage unavailable */ }
  notify();
}

export function removeKey(id: ProviderId): void {
  try { window.localStorage.removeItem(keyStorageKey(id)); } catch { /* ignore */ }
  // If the removed provider was selected, fall back to another configured one.
  if (getSelected() === id) {
    const next = configuredProviders()[0];
    try {
      if (next) window.localStorage.setItem(SELECTED_KEY, next);
      else window.localStorage.removeItem(SELECTED_KEY);
    } catch { /* ignore */ }
  }
  notify();
}

/** Optional per-provider model override (defaults to the provider's model). */
export function getModel(id: ProviderId): string | null {
  try { return window.localStorage.getItem(MODEL_KEY(id)) || null; } catch { return null; }
}
export function setModel(id: ProviderId, model: string): void {
  try {
    if (model.trim()) window.localStorage.setItem(MODEL_KEY(id), model.trim());
    else window.localStorage.removeItem(MODEL_KEY(id));
  } catch { /* ignore */ }
  notify();
}

/** Provider ids that currently have a key stored, in catalog order. */
export function configuredProviders(): ProviderId[] {
  return PROVIDERS.filter((p) => getKey(p.id)).map((p) => p.id);
}

export function getSelected(): ProviderId | null {
  try {
    const sel = window.localStorage.getItem(SELECTED_KEY) as ProviderId | null;
    if (sel && getKey(sel)) return sel;
  } catch { /* ignore */ }
  // Auto-select the first configured provider when none is pinned.
  return configuredProviders()[0] ?? null;
}

export function setSelected(id: ProviderId): void {
  try { window.localStorage.setItem(SELECTED_KEY, id); } catch { /* ignore */ }
  notify();
}

export function hasAnyLlm(): boolean {
  return configuredProviders().length > 0;
}
