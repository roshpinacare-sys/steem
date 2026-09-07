/**
 * docsIntent.ts — a one-shot handoff so any page can open the Docs reader at
 * a specific document (e.g. Governance → docs/POLICY.md) without widening the
 * navigate() signature.
 */
let pending: string | null = null;

export function setDocsIntent(path: string): void {
  pending = path;
}

export function consumeDocsIntent(): string | null {
  const p = pending;
  pending = null;
  return p;
}
