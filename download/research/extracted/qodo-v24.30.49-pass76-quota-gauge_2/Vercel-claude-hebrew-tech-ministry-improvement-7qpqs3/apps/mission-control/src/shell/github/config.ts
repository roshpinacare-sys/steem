/**
 * github/config.ts — device-local GitHub connection for Live mode.
 *
 * A fine-grained personal access token plus one repository turns the app into
 * a real operations console: actual workflow runs, jobs, commits, and pull
 * requests, and real dispatch through workflow_dispatch. The token never
 * leaves the device (localStorage), exactly like the proxy passphrase.
 */

const TOKEN_KEY = "qodo:github-token";
const REPO_KEY = "qodo:github-repo";
const BRANCH_KEY = "qodo:github-branch";
const USER_KEY = "qodo:github-user";

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  /** Default branch, learned during verification; dispatch targets it. */
  branch: string;
}

/** The authenticated GitHub account — the app's identity in Live mode. */
export interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

const listeners = new Set<() => void>();

export function getGitHubConfig(): GitHubConfig | null {
  try {
    const token = window.localStorage.getItem(TOKEN_KEY) ?? "";
    const full = window.localStorage.getItem(REPO_KEY) ?? "";
    const branch = window.localStorage.getItem(BRANCH_KEY) ?? "main";
    const [owner, repo] = full.split("/");
    if (!token || !owner || !repo) return null;
    return { token, owner, repo, branch };
  } catch {
    return null;
  }
}

export function setGitHubConfig(token: string, ownerRepo: string, branch: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(REPO_KEY, ownerRepo);
    window.localStorage.setItem(BRANCH_KEY, branch);
  } catch {
    /* storage unavailable */
  }
  for (const l of listeners) l();
}

/**
 * Persist just the token + identity — used by the stepped connect flow the
 * moment the token authenticates, BEFORE a repository is chosen. The app is
 * "signed in" (identity known) even while the operator is still picking a repo.
 */
export function setGitHubToken(token: string, user: GitHubUser): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
    window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* storage unavailable */
  }
  for (const l of listeners) l();
}

export function getGitHubToken(): string | null {
  try { return window.localStorage.getItem(TOKEN_KEY) || null; } catch { return null; }
}

export function getGitHubUser(): GitHubUser | null {
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as GitHubUser) : null;
  } catch { return null; }
}

export function setGitHubUser(user: GitHubUser): void {
  try { window.localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* ignore */ }
  for (const l of listeners) l();
}

/**
 * The repository + branch preference on this device, independent of whether a
 * token is present yet. A teammate who imports a team setup code has this
 * seeded before they sign in, so the connect flow can auto-select it the
 * moment their token authenticates. Returns null when nothing is stored.
 */
export function getGitHubRepoPref(): { ownerRepo: string; branch: string } | null {
  try {
    const ownerRepo = window.localStorage.getItem(REPO_KEY) ?? "";
    if (!REPO_RE.test(ownerRepo)) return null;
    const branch = window.localStorage.getItem(BRANCH_KEY) || "main";
    return { ownerRepo, branch };
  } catch {
    return null;
  }
}

const REPO_RE = /^[^/\s]+\/[^/\s]+$/;

/** Record the chosen repository + branch on top of an already-signed-in token. */
export function setGitHubRepo(ownerRepo: string, branch: string): void {
  try {
    window.localStorage.setItem(REPO_KEY, ownerRepo);
    window.localStorage.setItem(BRANCH_KEY, branch);
  } catch {
    /* storage unavailable */
  }
  for (const l of listeners) l();
}

export function clearGitHubConfig(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(REPO_KEY);
    window.localStorage.removeItem(BRANCH_KEY);
    window.localStorage.removeItem(USER_KEY);
  } catch {
    /* storage unavailable */
  }
  for (const l of listeners) l();
}

export function onGitHubConfigChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
