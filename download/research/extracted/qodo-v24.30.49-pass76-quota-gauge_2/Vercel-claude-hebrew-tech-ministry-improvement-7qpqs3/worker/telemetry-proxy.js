/**
 * telemetry-proxy.js — Cloudflare Worker proxy (hardened)
 *
 * Changes in Pass 4:
 *  - Per-IP rate limiting via a sliding window counter in Redis
 *  - Structured JSON error responses on all error paths
 *  - Strict CORS: only allow origins matching ALLOWED_ORIGINS env var
 *  - Request-size guard (POST bodies capped at 64 KB)
 *  - `e.message` → structured error extraction (no bare property access)
 *  - /health endpoint for uptime monitoring
 *
 * Changes in Pass 43 (T1 security fix):
 *  - The browser no longer authenticates with the static, build-time
 *    QODO_DISPATCH_SECRET. It now exchanges the passphrase once (typed by
 *    the operator, never embedded in the JS bundle) for a short-lived,
 *    signed session token via POST /session/issue, and uses that token
 *    (header or query param) for everything else. QODO_DISPATCH_SECRET and
 *    GITHUB_TOKEN never leave this Worker.
 *  - Added GET /prefetch-content: the browser used to hold a raw GitHub
 *    OAuth token and call api.github.com directly. It now calls this
 *    endpoint instead; the Worker makes the GitHub call server-side.
 */

const MAX_POLL_DURATION_MS = 25_000;
const POLL_INTERVAL_MS = 500;
const MAX_BODY_BYTES = 64 * 1024; // 64 KB guard
const RATE_LIMIT_WINDOW_S = 60;   // 1-minute sliding window
const RATE_LIMIT_MAX_REQ  = 120;  // max requests per IP per window
const KEY_PREFIX = "qodo:v24:";   // all Redis keys live under this namespace
const SESSION_TTL_S = 30 * 60;    // session tokens are valid for 30 minutes

// Allowed test commands for edge compute offloading. Any command outside this
// set is rejected before it reaches the opt-in Mission Control client.
const ALLOWED_TEST_COMMANDS = new Set([
  "npm test",
  "npm run test",
  "npx vitest run",
  "npx tsc --noEmit",
]);

function getClientIp(request) {
  return request.headers.get("CF-Connecting-IP") ||
         request.headers.get("X-Forwarded-For")?.split(",")[0].trim() ||
         "unknown";
}

function sessionCredential(request) {
  // EventSource (SSE) cannot set custom headers, so GET requests may
  // authenticate via the `session` query parameter over HTTPS instead.
  // Mutating requests must still use the X-Qodo-Session header.
  const header = request.headers.get("X-Qodo-Session") || "";
  if (header) return header;
  if (request.method === "GET") {
    const url = new URL(request.url);
    return url.searchParams.get("session") || "";
  }
  return "";
}

// ---------------------------------------------------------------------------
// Session tokens — HMAC-signed, short-lived, minted only after the caller
// proves knowledge of QODO_DISPATCH_SECRET. The secret itself is never sent
// to, or stored by, the browser beyond the single /session/issue exchange.
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromB64Url(s) {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}

function toB64Url(s) {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Constant-time string comparison via the double-HMAC trick: comparing
 * HMAC(k, a) with HMAC(k, b) under an ephemeral key leaks nothing about
 * either input through timing, unlike a raw `!==` on the secret itself.
 */
async function timingSafeStringEqual(a, b) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const [da, db] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(String(a))),
    crypto.subtle.sign("HMAC", key, enc.encode(String(b))),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

async function hmacKey(env) {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(env.QODO_DISPATCH_SECRET || ""),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Mint a signed `payload.signature` token good for SESSION_TTL_S seconds. */
async function issueSessionToken(env) {
  const expiresAt = Date.now() + SESSION_TTL_S * 1000;
  const payload = toB64Url(JSON.stringify({ exp: expiresAt }));
  const key = await hmacKey(env);
  const sig = await crypto.subtle.sign("HMAC", key, textEncoder.encode(payload));
  return { token: `${payload}.${toHex(sig)}`, expiresAt };
}

/** Verify a session token's signature and expiry. Returns true/false. */
async function verifySessionToken(env, token) {
  if (!token || !env.QODO_DISPATCH_SECRET) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, sigHex] = parts;
  let sigBytes;
  try {
    sigBytes = Uint8Array.from(sigHex.match(/.{2}/g).map((b) => parseInt(b, 16)));
  } catch {
    return false;
  }
  const key = await hmacKey(env);
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes, textEncoder.encode(payload));
  if (!ok) return false;
  try {
    const { exp } = JSON.parse(fromB64Url(payload));
    return typeof exp === "number" && Date.now() < exp;
  } catch {
    return false;
  }
}

function corsHeaders(env, request) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((o) => o.trim());
  const allowOrigin = allowed.includes("*") || allowed.includes(origin) ? origin || "*" : "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Qodo-Session",
    "Access-Control-Max-Age": "86400",
  };
}

function unauthorized(env, request) {
  return new Response(JSON.stringify({ error: "unauthorized", code: 401 }), {
    status: 401,
    headers: { "Content-Type": "application/json", ...corsHeaders(env, request) },
  });
}

function tooManyRequests(env, request) {
  return new Response(JSON.stringify({ error: "rate limit exceeded", code: 429 }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(RATE_LIMIT_WINDOW_S), ...corsHeaders(env, request) },
  });
}

function jsonResponse(env, request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env, request) },
  });
}

function errMsg(e) {
  return e instanceof Error ? e.message : String(e);
}

async function upstash(env, cmd) {
  const r = await fetch(
    `${env.UPSTASH_REDIS_REST_URL}/${cmd.map(encodeURIComponent).join("/")}`,
    { headers: { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}` } },
  );
  return r.json();
}

/** Sliding-window rate limiter using Redis INCR + EXPIRE. */
async function checkRateLimit(env, ip) {
  const key = `${KEY_PREFIX}rl:${ip}`;
  const data = await upstash(env, ["incr", key]);
  const count = data.result ?? 0;
  if (count === 1) {
    // First request in window — set expiry
    await upstash(env, ["expire", key, String(RATE_LIMIT_WINDOW_S)]);
  }
  return count <= RATE_LIMIT_MAX_REQ;
}

/**
 * Trigger the agent-pipeline workflow. `inputs` is passed through to the
 * workflow_dispatch `inputs` object, so callers can send `objective` (the
 * original manual-dispatch path) or resume-specific inputs like
 * `{ objective, issue_number, task_id, trigger }` (ADR-005 resume loop).
 * A bare-string `inputs` is accepted for backward compatibility and treated
 * as `{ objective }`.
 *
 * @param {object} env
 * @param {string} owner
 * @param {string} repo
 * @param {Record<string,string>|string} inputs
 * @param {string} [ref] Git ref to dispatch on (default "main").
 */
async function dispatchWorkflow(env, owner, repo, inputs, ref = "main") {
  const dispatchInputs = typeof inputs === "string" ? { objective: inputs } : inputs;
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/agent-pipeline.yml/dispatches`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref, inputs: dispatchInputs }),
    },
  );
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`GitHub dispatch failed ${r.status}: ${text}`);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight — must bypass auth + rate-limit checks
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    // /health — unauthenticated uptime probe
    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse(env, request, { ok: true, ts: Date.now() });
    }

    // Rate limiting (per IP)
    const ip = getClientIp(request);
    const withinLimit = await checkRateLimit(env, ip).catch(() => true); // fail-open
    if (!withinLimit) return tooManyRequests(env, request);

    // ── POST /session/issue — the ONLY place QODO_DISPATCH_SECRET is ever
    // compared directly. The browser sends it once (typed by the operator,
    // never embedded in the build) and receives a short-lived signed token
    // in return. This request is exempt from the session-token check below,
    // since its whole purpose is to obtain that token.
    if (url.pathname === "/session/issue" && request.method === "POST") {
      try {
        if ((request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
          return jsonResponse(env, request, { error: "request body too large" }, 413);
        }
        const { secret } = await request.json();
        if (!secret || !(await timingSafeStringEqual(secret, env.QODO_DISPATCH_SECRET))) {
          return unauthorized(env, request);
        }
        const { token, expiresAt } = await issueSessionToken(env);
        return jsonResponse(env, request, { token, expiresAt });
      } catch (e) {
        return jsonResponse(env, request, { error: errMsg(e) }, 500);
      }
    }

    // Auth — every route below requires a valid, unexpired session token.
    if (!(await verifySessionToken(env, sessionCredential(request)))) {
      return unauthorized(env, request);
    }

    // ── GET /telemetry ──────────────────────────────────────────────────────
    if (url.pathname === "/telemetry" && request.method === "GET") {
      const limit   = Number(url.searchParams.get("limit") || "200");
      const clamped = Math.max(1, Math.min(limit, 1000));
      const data    = await upstash(env, ["lrange", `${KEY_PREFIX}telemetry:events`, 0, clamped - 1]);
      if (!data.result || !Array.isArray(data.result)) return jsonResponse(env, request, []);
      const events = data.result
        .map((s) => { try { return JSON.parse(s); } catch { return null; } })
        .filter(Boolean);
      return jsonResponse(env, request, events);
    }

    // ── GET /trigger-queue/health ─────────────────────────────────────────────
    // Resume-loop backlog visibility (ADR-005): queued/processing/dead depths
    // so operators and Mission Control can see the drain keeping up and catch a
    // dead-letter backlog without shell access. Read-only LLEN; session-gated.
    if (url.pathname === "/trigger-queue/health" && request.method === "GET") {
      const [queued, processing, dead] = await Promise.all([
        upstash(env, ["llen", "qodo:trigger:queue"]),
        upstash(env, ["llen", "qodo:trigger:processing"]),
        upstash(env, ["llen", "qodo:trigger:dead"]),
      ]);
      const n = (r) => (typeof r?.result === "number" ? r.result : 0);
      return jsonResponse(env, request, {
        queued: n(queued),
        processing: n(processing),
        dead: n(dead),
        ts: Date.now(),
      });
    }

    // ── GET /prefetch-signals ───────────────────────────────────────────────
    if (url.pathname === "/prefetch-signals" && request.method === "GET") {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      const pollJob = (async () => {
        let lastIndex = 0;
        const deadline = Date.now() + MAX_POLL_DURATION_MS;
        try {
          while (Date.now() < deadline) {
            const data = await upstash(env, ["lrange", `${KEY_PREFIX}prefetch:signals`, 0, 49]);
            if (Array.isArray(data.result)) {
              const newItems = data.result.slice(lastIndex);
              for (const item of newItems) {
                await writer.write(encoder.encode(`data: ${item}\n\n`));
                lastIndex++;
              }
            }
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            await new Promise((r) => setTimeout(r, Math.min(POLL_INTERVAL_MS, remaining)));
          }
          await writer.write(encoder.encode(`retry: 0\n\n`));
        } catch {
          // Client disconnected — silently close.
        } finally {
          writer.close().catch(() => {});
        }
      })();

      if (typeof ctx !== "undefined" && ctx?.waitUntil) ctx.waitUntil(pollJob);

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no",
          ...corsHeaders(env, request),
        },
      });
    }

    // ── POST /prefetch-answer ───────────────────────────────────────────────
    if (url.pathname === "/prefetch-answer" && request.method === "POST") {
      try {
        if ((request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
          return jsonResponse(env, request, { error: "request body too large" }, 413);
        }
        const { requestId, answerSdp } = await request.json();
        if (!requestId || !answerSdp) {
          return jsonResponse(env, request, { error: "requestId and answerSdp are required" }, 400);
        }
        const payload = JSON.stringify({ type: "answer", requestId, answerSdp });
        await upstash(env, ["lpush", `${KEY_PREFIX}prefetch:answer:${requestId}`, payload]);
        await upstash(env, ["expire", `${KEY_PREFIX}prefetch:answer:${requestId}`, "30"]);
        return jsonResponse(env, request, { ok: true });
      } catch (e) {
        return jsonResponse(env, request, { error: errMsg(e) }, 500);
      }
    }

    // ── GET /compute/requests ───────────────────────────────────────────────
    if (url.pathname === "/compute/requests" && request.method === "GET") {
      const requests = [];
      for (let i = 0; i < 10; i++) {
        const data = await upstash(env, ["rpop", `${KEY_PREFIX}compute:requests:pending`]);
        if (!data.result) break;
        try {
          const parsed = JSON.parse(data.result);
          if (parsed?.testCommand && ALLOWED_TEST_COMMANDS.has(parsed.testCommand)) {
            requests.push(parsed);
          }
        } catch { /* ignore */ }
      }
      return jsonResponse(env, request, requests);
    }

    // ── POST /compute/result ────────────────────────────────────────────────
    if (url.pathname === "/compute/result" && request.method === "POST") {
      try {
        if ((request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
          return jsonResponse(env, request, { error: "request body too large" }, 413);
        }
        const { requestId, passed, logs } = await request.json();
        if (!requestId) return jsonResponse(env, request, { error: "requestId is required" }, 400);
        await upstash(env, [
          "set",
          `${KEY_PREFIX}compute:result:${requestId}`,
          JSON.stringify({ requestId, passed, logs }),
        ]);
        return jsonResponse(env, request, { ok: true });
      } catch (e) {
        return jsonResponse(env, request, { error: errMsg(e) }, 500);
      }
    }

    // ── POST /dispatch ──────────────────────────────────────────────────────
    if (url.pathname === "/dispatch" && request.method === "POST") {
      try {
        if ((request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
          return jsonResponse(env, request, { error: "request body too large" }, 413);
        }
        const { objective, repo, dryRun } = await request.json();
        if (!objective || !repo) {
          return jsonResponse(env, request, { error: "objective and repo are required" }, 400);
        }
        const [owner, repoName] = String(repo).split("/");
        if (!owner || !repoName) {
          return jsonResponse(env, request, { error: "repo must be owner/name" }, 400);
        }
        // dryRun maps to the workflow's `dry_run` input, which the agent-pipeline
        // job turns into the CLI `--dry-run` flag (plan/code/gate, no writes).
        const inputs = dryRun ? { objective, dry_run: "true" } : objective;
        await dispatchWorkflow(env, owner, repoName, inputs);
        return jsonResponse(env, request, { ok: true, repo, objective, dryRun: Boolean(dryRun) });
      } catch (e) {
        return jsonResponse(env, request, { error: errMsg(e) }, 500);
      }
    }

    // ── POST /mentor/decision ───────────────────────────────────────────────
    // Closes the mentor-approval loop: writes the exact Redis key that the
    // agent's waitForMentorApproval() polls (qodo:v24:mentor:{owner}:{repo}:{pr}).
    // The owner/repo/prNumber triple comes from the "pre-commit-pause"
    // telemetry event the agent emits when it starts waiting. TTL 1 hour —
    // the agent's own wait window is 30 minutes, so a stale decision can
    // never leak into a later run's gate.
    if (url.pathname === "/mentor/decision" && request.method === "POST") {
      try {
        if ((request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
          return jsonResponse(env, request, { error: "request body too large" }, 413);
        }
        const { owner, repo, prNumber, status, reason } = await request.json();
        if (!owner || !repo || !Number.isInteger(prNumber)) {
          return jsonResponse(env, request, { error: "owner, repo and integer prNumber are required" }, 400);
        }
        if (status !== "approved" && status !== "rejected") {
          return jsonResponse(env, request, { error: "status must be 'approved' or 'rejected'" }, 400);
        }
        const key = `${KEY_PREFIX}mentor:${owner}:${repo}:${prNumber}`;
        const value = JSON.stringify(
          status === "rejected" ? { status, reason: String(reason ?? "").slice(0, 2000) } : { status },
        );
        const res = await upstash(env, ["set", key, value, "EX", "3600"]);
        if (res.error) throw new Error(String(res.error));
        return jsonResponse(env, request, { ok: true, status });
      } catch (e) {
        return jsonResponse(env, request, { error: errMsg(e) }, 500);
      }
    }

    // ── GET /events — SSE live log stream ────────────────────────────────────
    if (url.pathname === "/events" && request.method === "GET") {
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      const streamJob = (async () => {
        let lastIndex = 0;
        const deadline = Date.now() + MAX_POLL_DURATION_MS;
        const HEARTBEAT_INTERVAL_MS = 15_000; // emit SSE keepalive every 15 s
        let lastHeartbeat = Date.now();
        try {
          // Send a connected comment immediately so the client knows it's live.
          await writer.write(encoder.encode(": connected\n\n"));
          while (Date.now() < deadline) {
            const data = await upstash(env, ["lrange", `${KEY_PREFIX}telemetry:events`, 0, 199]);
            if (Array.isArray(data.result)) {
              // Events are stored newest-first (LPUSH); reverse for chronological order.
              const ordered = [...data.result].reverse();
              const newItems = ordered.slice(lastIndex);
              for (const item of newItems) {
                await writer.write(encoder.encode(`data: ${item}\n\n`));
                lastIndex++;
              }
            }
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            // Emit a heartbeat comment every 15 s to keep proxies from closing
            // the idle connection — not on every 500 ms poll iteration.
            if (Date.now() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
              await writer.write(encoder.encode(": heartbeat\n\n"));
              lastHeartbeat = Date.now();
            }
            await new Promise((r) => setTimeout(r, Math.min(POLL_INTERVAL_MS, remaining)));
          }
        } catch {
          // Client disconnected — silently close.
        } finally {
          writer.close().catch(() => {});
        }
      })();

      if (typeof ctx !== "undefined" && ctx?.waitUntil) ctx.waitUntil(streamJob);

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no",
          ...corsHeaders(env, request),
        },
      });
    }

    // ── GET /prefetch-content — server-side GitHub Contents API proxy ───────
    // The browser used to hold a raw GitHub OAuth token (VITE_GITHUB_OAUTH_TOKEN)
    // and call api.github.com directly. That token now lives only here, in
    // GITHUB_TOKEN, and never reaches the client.
    if (url.pathname === "/prefetch-content" && request.method === "GET") {
      const owner = url.searchParams.get("owner") || "";
      const repo  = url.searchParams.get("repo") || "";
      const path  = url.searchParams.get("path") || "";
      const ref   = url.searchParams.get("ref") || "";
      if (!owner || !repo || !path || !ref) {
        return jsonResponse(env, request, { error: "owner, repo, path and ref are required" }, 400);
      }
      try {
        const ghUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?ref=${encodeURIComponent(ref)}`;
        const r = await fetch(ghUrl, {
          headers: {
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            Accept: "application/vnd.github.v3.raw",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });
        if (!r.ok) return jsonResponse(env, request, { error: `GitHub ${r.status}` }, 502);
        const content = await r.text();
        return jsonResponse(env, request, { content });
      } catch (e) {
        return jsonResponse(env, request, { error: errMsg(e) }, 500);
      }
    }

    return jsonResponse(env, request, { error: "not found" }, 404);
  },
};
