/**
 * ConnectSurface — what the app leads with when nothing is connected, and the
 * reusable GitHub connect flow used in Connections/Settings.
 *
 * The flow is stepped, like a real sign-in: paste a token (the app learns WHO
 * you are), pick a repository from YOUR list (no hand-typing owner/repo), pick
 * a branch, done. Right after connecting it checks whether the repo actually
 * carries the agent's dispatch workflow and says so honestly — that missing
 * workflow is the real reason "New task" used to do nothing.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { UI, FONT, MONO, Panel, Button, Pill, Dot } from "./ui.js";
import { Icon } from "./icons.js";
import {
  getGitHubConfig, getGitHubToken, getGitHubUser, getGitHubRepoPref, setGitHubToken, setGitHubRepo,
  setGitHubUser, clearGitHubConfig, type GitHubUser,
} from "./github/config.js";
import {
  ghAuthenticate, ghListRepos, ghListBranches, ghWorkflowExists, ghVerify,
  type GhRepo, type GhBranch,
} from "./github/client.js";
import type { PageProps } from "./PlatformShell.js";

const field: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "11px 13px", borderRadius: 11,
  fontFamily: MONO, fontSize: 13, background: UI.bgElevated,
  border: `1px solid ${UI.borderStrong}`, color: UI.textPrimary, outline: "none",
};

const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase",
  fontWeight: 700, color: UI.textMuted, marginBottom: 7,
};

type Step = "token" | "repo" | "branch" | "connected";

function Avatar({ user, size = 28 }: { user: GitHubUser; size?: number }): React.ReactElement {
  const [failed, setFailed] = useState(false);
  if (user.avatarUrl && !failed) {
    return <img src={user.avatarUrl} alt="" width={size} height={size} onError={() => setFailed(true)}
      style={{ borderRadius: "50%", flexShrink: 0, border: `1px solid ${UI.border}`, objectFit: "cover" }} />;
  }
  return (
    <span style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
      background: `linear-gradient(135deg, ${UI.indigo}, ${UI.purple})`, color: UI.textWhite, fontSize: size * 0.42, fontWeight: 700 }}>
      {(user.login[0] ?? "?").toUpperCase()}
    </span>
  );
}

/** Token → identity → repository → branch → verified live connection. */
export function GitHubConnectCard({ onConnected }: { onConnected?: () => void }): React.ReactElement {
  const [step, setStep] = useState<Step>("token");
  const [token, setTokenInput] = useState("");
  const [identity, setIdentity] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<GhRepo[] | null>(null);
  const [filter, setFilter] = useState("");
  const [chosen, setChosen] = useState<GhRepo | null>(null);
  const [branches, setBranches] = useState<GhBranch[] | null>(null);
  const [branch, setBranch] = useState("");
  const [workflowOk, setWorkflowOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set right after a fresh sign-in so the repo list, once loaded, auto-selects
  // a repository the operator already pointed this device at (e.g. imported
  // from a team setup code). Never fires when browsing via "Change repo".
  const wantAutoSelect = useRef(false);

  const loadRepos = useCallback(async (tok: string) => {
    setBusy(true); setError(null);
    try {
      const list = await ghListRepos(tok);
      setRepos(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "could not list repositories");
    } finally { setBusy(false); }
  }, []);

  // Resume wherever the operator left off: fully connected, or signed-in but
  // still repo-less. A stored token is a claim — re-verify it in the background.
  useEffect(() => {
    const cfg = getGitHubConfig();
    if (cfg) {
      setStep("connected");
      setIdentity(getGitHubUser() ?? { login: cfg.owner, name: null, avatarUrl: null });
      setChosen({ fullName: `${cfg.owner}/${cfg.repo}`, owner: cfg.owner, name: cfg.repo, private: false, defaultBranch: cfg.branch, canPush: true, pushedAt: "" });
      setBranch(cfg.branch);
      let live = true;
      ghVerify(cfg)
        .then((v) => { if (live) setGitHubUser({ login: v.login, name: getGitHubUser()?.name ?? null, avatarUrl: getGitHubUser()?.avatarUrl ?? null }); })
        .catch((e: unknown) => { if (live) setError(e instanceof Error ? `Stored token failed — ${e.message}` : "stored token failed"); });
      ghWorkflowExists(cfg).then((ok) => { if (live) setWorkflowOk(ok); }).catch(() => {});
      return () => { live = false; };
    }
    const tok = getGitHubToken();
    const user = getGitHubUser();
    if (tok && user) { setIdentity(user); setStep("repo"); wantAutoSelect.current = true; void loadRepos(tok); }
    return undefined;
  }, [loadRepos]);

  // Auto-select a preferred repo once the list arrives after a fresh sign-in.
  useEffect(() => {
    if (!wantAutoSelect.current || step !== "repo" || !repos) return;
    wantAutoSelect.current = false;
    const pref = getGitHubRepoPref();
    if (!pref) return;
    const match = repos.find((r) => r.fullName.toLowerCase() === pref.ownerRepo.toLowerCase());
    if (match) void pickRepo({ ...match, defaultBranch: pref.branch || match.defaultBranch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repos, step]);

  const authenticate = async () => {
    const t = token.trim();
    if (!t) { setError("Paste a GitHub token."); return; }
    setBusy(true); setError(null);
    try {
      const id = await ghAuthenticate(t);
      setGitHubToken(t, id);
      setIdentity(id);
      setStep("repo");
      wantAutoSelect.current = true;
      void loadRepos(t);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "token verification failed");
    } finally { setBusy(false); }
  };

  const pickRepo = async (r: GhRepo) => {
    setChosen(r);
    setBranch(r.defaultBranch);
    setBranches(null);
    setWorkflowOk(null);
    setStep("branch");
    const tok = getGitHubToken();
    if (!tok) return;
    const cfg = { token: tok, owner: r.owner, repo: r.name, branch: r.defaultBranch };
    ghListBranches(cfg).then(setBranches).catch(() => setBranches([{ name: r.defaultBranch, protected: false }]));
    ghWorkflowExists(cfg).then(setWorkflowOk).catch(() => setWorkflowOk(null));
  };

  const finishConnect = () => {
    if (!chosen) return;
    setGitHubRepo(chosen.fullName, branch || chosen.defaultBranch);
    setStep("connected");
    onConnected?.();
  };

  const disconnect = () => {
    clearGitHubConfig();
    setStep("token"); setTokenInput(""); setIdentity(null); setRepos(null);
    setChosen(null); setBranches(null); setBranch(""); setWorkflowOk(null); setError(null);
  };

  // ── Connected ─────────────────────────────────────────────────────────────
  if (step === "connected" && chosen && identity) {
    return (
      <Panel pad={16} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Avatar user={identity} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: UI.textPrimary, display: "flex", alignItems: "center", gap: 8 }}>
              {identity.name || identity.login}
              <Pill color={error ? UI.red : UI.green}>{error ? "token invalid" : "signed in"}</Pill>
            </div>
            <div style={{ fontSize: 11.5, color: UI.textMuted }}>@{identity.login}</div>
          </div>
          <Dot color={error ? UI.red : UI.green} glow={!error} />
        </div>
        <div style={{ borderTop: `1px solid ${UI.border}`, paddingTop: 10, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <Icon name="connections" size={14} />
          <span style={{ fontSize: 12.5, color: UI.textSecondary, fontFamily: MONO }}>{chosen.fullName}</span>
          <Pill color={UI.indigo}>{branch}</Pill>
          {workflowOk === true && <Pill color={UI.green}>workflow ready</Pill>}
          {workflowOk === false && <Pill color={UI.amber}>no agent workflow</Pill>}
        </div>
        {workflowOk === false && (
          <div style={{ fontSize: 12, color: UI.amber, lineHeight: 1.55, background: "rgba(251,191,36,0.08)", border: `1px solid ${UI.amber}33`, borderRadius: 10, padding: "10px 12px" }}>
            This repo has no <span style={{ fontFamily: MONO }}>.github/workflows/agent-pipeline.yml</span>, so <strong>New task</strong> has nothing to dispatch.
            Files, runs, PRs, and the chat commands all work now — add the agent workflow to unlock real dispatch.
          </div>
        )}
        {error && <div role="alert" style={{ fontSize: 12, color: UI.red, lineHeight: 1.5 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <Button onClick={() => { setStep("repo"); const tok = getGitHubToken(); if (tok && !repos) void loadRepos(tok); }}>Change repo</Button>
          <Button color={UI.red} onClick={disconnect}>Disconnect</Button>
        </div>
      </Panel>
    );
  }

  // ── Step: pick branch ───────────────────────────────────────────────────────
  if (step === "branch" && chosen) {
    return (
      <Panel pad={16} style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        <StepHeader identity={identity} label={chosen.fullName} onBack={() => setStep("repo")} />
        <div>
          <label style={lbl}>Branch</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
            {(branches ?? [{ name: chosen.defaultBranch, protected: false }]).map((b) => {
              const on = b.name === branch;
              return (
                <button key={b.name} onClick={() => setBranch(b.name)} style={{
                  display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                  textAlign: "left", fontFamily: FONT, fontSize: 13, fontWeight: on ? 650 : 500,
                  color: on ? UI.textWhite : UI.textSecondary, background: on ? UI.bgActive : UI.bgElevated,
                  border: `1px solid ${on ? "rgba(99,102,241,0.4)" : UI.border}` }}>
                  <Icon name="pipeline" size={14} />
                  <span style={{ fontFamily: MONO, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
                  {b.name === chosen.defaultBranch && <Pill color={UI.textMuted}>default</Pill>}
                  {b.protected && <Pill color={UI.amber}>protected</Pill>}
                </button>
              );
            })}
            {branches === null && <div style={{ fontSize: 12, color: UI.textMuted, padding: 6 }}>Loading branches…</div>}
          </div>
        </div>
        {workflowOk === false && (
          <div style={{ fontSize: 11.5, color: UI.amber, lineHeight: 1.5 }}>
            Heads up: this repo has no agent workflow yet — dispatch will be inactive, everything else works.
          </div>
        )}
        <Button variant="primary" onClick={finishConnect}>
          <Icon name="check" size={15} /> Connect {chosen.name}
        </Button>
      </Panel>
    );
  }

  // ── Step: pick repository ───────────────────────────────────────────────────
  if (step === "repo") {
    const shown = (repos ?? []).filter((r) => r.fullName.toLowerCase().includes(filter.trim().toLowerCase()));
    return (
      <Panel pad={16} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <StepHeader identity={identity} label="Choose a repository" onBack={disconnect} backLabel="Sign out" />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter your repositories…" spellCheck={false} style={field} />
        {error && <div role="alert" style={{ fontSize: 12.5, color: UI.red }}>{error}</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
          {repos === null && <div style={{ fontSize: 12.5, color: UI.textMuted, padding: 8 }}>Loading your repositories…</div>}
          {repos !== null && shown.length === 0 && <div style={{ fontSize: 12.5, color: UI.textMuted, padding: 8 }}>No repositories match.</div>}
          {shown.map((r) => (
            <button key={r.fullName} onClick={() => void pickRepo(r)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, cursor: "pointer",
              textAlign: "left", fontFamily: FONT, background: UI.bgElevated, border: `1px solid ${UI.border}` }}>
              <Icon name={r.private ? "safety" : "connections"} size={15} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: UI.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.fullName}</div>
                <div style={{ fontSize: 10.5, color: UI.textMuted }}>{r.private ? "private" : "public"} · default {r.defaultBranch}</div>
              </div>
              {!r.canPush && <Pill color={UI.amber}>read-only</Pill>}
              <Icon name="chevron" size={13} />
            </button>
          ))}
        </div>
      </Panel>
    );
  }

  // ── Step: paste token ───────────────────────────────────────────────────────
  return (
    <Panel pad={16} style={{ display: "flex", flexDirection: "column", gap: 13 }}>
      <div>
        <label style={lbl}>Sign in with a GitHub token</label>
        <input type="password" value={token} onChange={(e) => setTokenInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void authenticate(); }}
          placeholder="ghp_… or github_pat_…" spellCheck={false} autoComplete="off" style={field} />
      </div>
      {error && <div role="alert" style={{ fontSize: 12.5, color: UI.red }}>{error}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Button variant="primary" onClick={authenticate} disabled={busy}>
          <Icon name="connections" size={15} /> {busy ? "Verifying…" : "Continue"}
        </Button>
        <span style={{ fontSize: 11.5, color: UI.textMuted }}>Stored on this device only — sent only to api.github.com.</span>
      </div>
      <div style={{ fontSize: 11, color: UI.textMuted, lineHeight: 1.55, borderTop: `1px solid ${UI.border}`, paddingTop: 10 }}>
        Use a <strong style={{ color: UI.textSecondary }}>fine-grained token</strong> with Contents (read/write) + Actions (read/write).
        Next you'll pick the repository and branch from your own list — no typing paths. Revoke it on GitHub anytime.
      </div>
    </Panel>
  );
}

function StepHeader({ identity, label, onBack, backLabel = "Back" }: { identity: GitHubUser | null; label: string; onBack: () => void; backLabel?: string }): React.ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {identity && <Avatar user={identity} size={24} />}
      <div style={{ minWidth: 0, flex: 1 }}>
        {identity && <div style={{ fontSize: 10.5, color: UI.textMuted }}>@{identity.login}</div>}
        <div style={{ fontSize: 13.5, fontWeight: 700, color: UI.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
      </div>
      <button onClick={onBack} style={{ fontSize: 12, color: UI.textMuted, background: "none", border: "none", cursor: "pointer", fontFamily: FONT, whiteSpace: "nowrap" }}>{backLabel}</button>
    </div>
  );
}

/** Full-page hero shown by pages when no source is connected. */
export function ConnectHero({ mc, navigate }: Pick<PageProps, "mc" | "navigate">): React.ReactElement {
  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "8px 0 40px", fontFamily: FONT }}>
      <div style={{ textAlign: "center", margin: "18px 0 22px" }}>
        <div style={{
          width: 52, height: 52, borderRadius: 15, margin: "0 auto 16px",
          background: `linear-gradient(135deg, ${UI.indigo}, ${UI.purple})`,
          display: "grid", placeItems: "center", boxShadow: `0 8px 30px ${UI.indigo}55`,
        }}>
          <Icon name="bolt" size={26} />
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: UI.textWhite, marginBottom: 8 }}>Connect your operations</div>
        <div style={{ fontSize: 13.5, color: UI.textMuted, lineHeight: 1.6 }}>
          Sign in with a GitHub token, pick a <strong style={{ color: UI.textSecondary }}>repository</strong> from your list, and this
          console runs on real data — live runs, job detail, commits, pull requests, and real task dispatch.
        </div>
      </div>

      <GitHubConnectCard />

      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0" }}>
        <div style={{ flex: 1, height: 1, background: UI.border }} />
        <span style={{ fontSize: 11, color: UI.textMuted, letterSpacing: 1, textTransform: "uppercase" }}>or</span>
        <div style={{ flex: 1, height: 1, background: UI.border }} />
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
        <Button onClick={() => navigate("settings")}><Icon name="connections" size={15} /> Connect telemetry proxy</Button>
        <Button color={UI.purple} onClick={() => mc.setDemoMode(true)}><Icon name="automations" size={15} /> Explore with the simulator</Button>
      </div>
      <div style={{ textAlign: "center", fontSize: 11.5, color: UI.textMuted, marginTop: 10, lineHeight: 1.5 }}>
        The simulator is clearly labeled and never mixes with live data — it's for exploring the UI, not a substitute for your real operations.
      </div>
    </div>
  );
}
