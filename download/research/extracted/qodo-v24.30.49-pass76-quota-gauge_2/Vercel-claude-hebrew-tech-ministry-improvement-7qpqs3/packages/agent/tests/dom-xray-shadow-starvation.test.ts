/**
 * dom-xray-shadow-starvation.test.ts — Task-26 (Pass 62)
 *
 * ADVERSARIAL AUDIT: Observation-window starvation in dom-xray.ts and shadow-traffic.ts
 *
 * ─── Background ─────────────────────────────────────────────────────────────
 * `dom-xray.ts` validates a deployed UI by fetching the URL once and inspecting
 * the static HTML snapshot: `allowed = hasRoot && errors === 0`.
 * `shadow-traffic.ts` validates backend health by probing three fixed paths
 * (`/`, `/api/health`, `/robots.txt`) once concurrently: `allowed = bad === 0`.
 *
 * Both validators share the same structural property: a **single observation
 * moment**. Neither samples over time, retries under different conditions, or
 * varies its request identity. This makes them susceptible to a class of
 * adversarial patches that behave correctly during the validator's narrow window
 * and degrade immediately after — the "starvation" attack pattern analogous to
 * task-8's chaos-circuit and task-11's trust-ledger gaming attacks.
 *
 * ─── Methodology ────────────────────────────────────────────────────────────
 * All tests use stateful `fetch` mocks that track call counts, inspect request
 * headers, or vary responses per path — simulating adversarial server behavior.
 * No real network calls are made. JSDOM is used as-is by `dom-xray.ts` (no
 * script execution, static parse only).
 *
 * ─── Findings summary ────────────────────────────────────────────────────────
 *
 * A. dom-xray baseline (existing behavior confirmed)
 *    A1. Clean HTML (hasRoot, no errors) → allowed=true         → RESISTANT
 *    A2. Missing root → allowed=false                           → RESISTANT
 *    A3. Error elements present → allowed=false                 → RESISTANT
 *    A4. url empty/falsy → allowed=true, skipped=true           → RESISTANT
 *
 * B. dom-xray observation-window starvation (request-counter attack)
 *    B1. First request clean, subsequent requests degraded →
 *        validator sees clean → allowed=true (gap real)         → GAP-1 (High)
 *    B2. K=1 counter — validator always lands in clean window   → GAP-1 (High)
 *    B3. Multiple validator calls, counter degrades at K=2 →
 *        only the first call matters for gate decision          → GAP-1 (High)
 *
 * C. dom-xray JS-execution blindness (static parse only)
 *    C1. Deferred error injection via `<script>setTimeout(...)` →
 *        JSDOM does not execute scripts → allowed=true          → GAP-2 (High)
 *    C2. Script that removes `#root` after 500ms → root present
 *        at parse time → hasRoot=true → allowed=true            → GAP-2 (High)
 *    C3. Script that adds `.error` class → not executed →
 *        errors=0 → allowed=true                               → GAP-2 (High)
 *
 * D. dom-xray semantic gaps
 *    D1. Empty SPA shell `<div id="root"></div>` → hasRoot=true,
 *        errors=0 → allowed=true (blank for real JS users)      → GAP-3 (Medium)
 *    D2. Bypass-header evasion — clean response only when
 *        x-vercel-protection-bypass header present →
 *        validator always gets clean; real users get degraded   → GAP-4 (Medium)
 *    D3. `data-error="false"` still counted as error (attribute
 *        selector `[data-error]` is value-agnostic)             → DB-4 (documented)
 *
 * E. shadow-traffic baseline (existing behavior confirmed)
 *    E1. All three paths 200 → allowed=true                     → RESISTANT
 *    E2. One path 500 → allowed=false                           → RESISTANT
 *    E3. /robots.txt 404 → still allowed (404 < 500)            → RESISTANT
 *
 * F. shadow-traffic observation-window starvation
 *    F1. First 3 requests return 200, subsequent return 500 →
 *        3-probe window always lands in clean zone              → GAP-5 (High)
 *    F2. Counter-based: 500s begin at request #4 → validator
 *        runs exactly 3 → always passes                         → GAP-5 (High)
 *    F3. Bypass-header evasion — 200 with header, 500 without   → GAP-6 (Medium)
 *
 * G. shadow-traffic semantic gaps (path coverage)
 *    G1. Only 3 hardcoded paths probed — critical app paths
 *        not covered (e.g. /api/data → 500) → allowed=true      → GAP-7 (Medium)
 *    G2. All 3 monitored paths healthy, unreachable 4th path
 *        would fail → zero indication                           → GAP-7 (Medium)
 *    G3. /robots.txt 404 reduces effective coverage to 2 paths  → GAP-8 (Low)
 *
 * H. Design boundaries / combined attack surface
 *    H1. DB-1: dom-xray is a static HTML snapshot at validation
 *        moment — JS-deferred errors are structurally invisible
 *    H2. DB-2: shadow-traffic gate is exactly 3 probes at one
 *        moment — not a sustained health check
 *    H3. DB-3: combined bypass-header attack defeats both
 *        validators simultaneously in a single deployment
 *
 * ─── Gaps Summary ────────────────────────────────────────────────────────────
 *
 * GAP-1 (High) — dom-xray single-shot: request-counter degradation undetectable
 * GAP-2 (High) — dom-xray JSDOM static-only: JS-deferred errors invisible
 * GAP-3 (Medium) — dom-xray semantic: empty SPA shell passes (hasRoot ≠ meaningful content)
 * GAP-4 (Medium) — dom-xray bypass-header evasion: clean response only when header present
 * GAP-5 (High) — shadow-traffic single-shot: counter-based 500s after K>3 undetectable
 * GAP-6 (Medium) — shadow-traffic bypass-header evasion: same as GAP-4 for traffic probe
 * GAP-7 (Medium) — shadow-traffic path coverage: only 3 fixed paths; app paths not probed
 * GAP-8 (Low) — shadow-traffic /robots.txt: 404 passes, reducing effective coverage to 2
 *
 * ─── Design Boundaries ───────────────────────────────────────────────────────
 *
 * DB-1: dom-xray is a static HTML snapshot — it captures the DOM as delivered by
 *   the server at the moment of the single fetch. JavaScript is not executed by
 *   JSDOM in the default `new JSDOM(html)` configuration (`runScripts` is not set
 *   to `"dangerously"`). Any error injected by client-side JS — regardless of
 *   when the injection occurs — is permanently invisible.
 *
 * DB-2: shadow-traffic's gate is `bad === 0` over exactly 3 concurrent probes at
 *   one instant. This is a point-in-time health snapshot, not sustained monitoring.
 *   A server that degrades on the 4th request, under load, or after a warm-up
 *   period cannot be distinguished from a fully healthy server.
 *
 * DB-3: Both validators issue requests with the same `x-vercel-protection-bypass`
 *   header on every call. A server that inspects this header can serve a "validator
 *   persona" consistently different from its production persona — a structural
 *   bypass that defeats both validators simultaneously.
 *
 * DB-4: dom-xray's `[data-error]` CSS attribute selector is value-agnostic.
 *   `<div data-error="false">` is counted as an error because the attribute is
 *   present regardless of its value. Legitimate frameworks that set `data-error`
 *   to a falsy string will be counted as errors — a false-positive risk worth
 *   documenting for future calibration.
 *
 * ─── Recommended Fixes ───────────────────────────────────────────────────────
 *
 * GAP-1/GAP-5 fix: Add a configurable re-check after a short delay (e.g. 2s)
 *   to detect components that degrade shortly after initial render. Even a
 *   second observation point greatly reduces the request-counter attack surface.
 *
 * GAP-2 fix: Extend dom-xray to optionally execute scripts via
 *   `new JSDOM(html, { runScripts: "dangerously" })` in a sandboxed context,
 *   or integrate a headless browser (Playwright/Puppeteer) with a configurable
 *   post-render settling time. Document the security boundary of each approach.
 *
 * GAP-3 fix: Add a content-size check — `hasRoot && rootElement.innerHTML.trim().length > 0`
 *   or a minimum child-count heuristic to distinguish meaningful content from an
 *   empty SPA shell.
 *
 * GAP-4/GAP-6 fix: Shadow-probe without the bypass header on a subset of requests
 *   to detect evasion. Alternatively, compare the bypass-header response against a
 *   no-header response and flag significant structural differences.
 *
 * GAP-7 fix: Accept a configurable `paths` array in `shadowTraffic` so callers
 *   can supply app-specific critical paths alongside the defaults.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { domXray } from "../src/validators/dom-xray.js";
import { shadowTraffic } from "../src/validators/shadow-traffic.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimal valid HTML — has a root element, zero error elements. */
const CLEAN_HTML = `<html><body><main id="app">App loaded successfully.</main></body></html>`;

/** HTML with a visible error element — should cause dom-xray to block. */
const ERROR_HTML = `<html><body><main id="app"></main><div data-error="true">Critical render error</div></body></html>`;

/** Empty SPA shell — has root element, no errors, but no meaningful content (client-rendered). */
const SPA_SHELL_HTML = `<html><body><div id="root"></div></body></html>`;

/** HTML that contains a deferred error injection script (not executed by JSDOM). */
const DEFERRED_ERROR_SCRIPT_HTML = `<html><body>
  <main id="app">Loading...</main>
  <script>
    setTimeout(function() {
      var el = document.createElement('div');
      el.setAttribute('data-error', 'true');
      el.textContent = 'Post-render critical failure';
      document.body.appendChild(el);
    }, 500);
  </script>
</body></html>`;

/** HTML with a script that removes the root element after a delay. */
const DEFERRED_ROOT_REMOVAL_HTML = `<html><body>
  <main id="app">Rendering...</main>
  <script>
    setTimeout(function() {
      var root = document.querySelector('main');
      if (root) root.parentNode.removeChild(root);
    }, 500);
  </script>
</body></html>`;

/** HTML with a script that adds a .error class after a delay. */
const DEFERRED_CLASS_ERROR_HTML = `<html><body>
  <main id="app">App</main>
  <script>
    setTimeout(function() {
      var el = document.createElement('div');
      el.className = 'error';
      el.textContent = 'Something went wrong';
      document.body.appendChild(el);
    }, 200);
  </script>
</body></html>`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a fetch mock returning a text/HTML response. */
function mockHtmlFetch(html: string, status = 200): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    text: async () => html,
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** Builds a fetch mock returning a status-only response (for shadow-traffic). */
function mockStatusFetch(status: number): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({ ok: status < 400, status });
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── A: dom-xray baseline ────────────────────────────────────────────────────

describe("A: dom-xray baseline (existing behavior confirmed)", () => {
  it("A1: clean HTML with root element and no error elements → allowed=true", async () => {
    mockHtmlFetch(CLEAN_HTML);
    const r = await domXray("https://example.com");
    expect(r.allowed).toBe(true);
    expect(r.hasRoot).toBe(true);
    expect(r.errors).toBe(0);
  });

  it("A2: HTML with no root element (#root, #__next, main, [data-app-root]) → allowed=false", async () => {
    mockHtmlFetch("<html><body><div class='content'>Page content</div></body></html>");
    const r = await domXray("https://example.com");
    expect(r.allowed).toBe(false);
    expect(r.hasRoot).toBe(false);
  });

  it("A3: HTML with [data-error] element present → errors>0 → allowed=false", async () => {
    mockHtmlFetch(ERROR_HTML);
    const r = await domXray("https://example.com");
    expect(r.allowed).toBe(false);
    expect(r.errors).toBeGreaterThan(0);
    expect(r.hasRoot).toBe(true); // root present but errors block
  });

  it("A4: empty url → allowed=true with skipped=true (fast path, no fetch)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await domXray("");
    expect(r.allowed).toBe(true);
    expect((r as { skipped?: boolean }).skipped).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── B: dom-xray observation-window starvation ───────────────────────────────

describe("B: dom-xray observation-window starvation — request-counter attack (GAP-1)", () => {
  /**
   * GAP-1 (High) — dom-xray single-shot snapshot.
   *
   * `domXray` issues exactly one HTTP request per invocation. A server that
   * tracks request count and returns clean HTML on request #1 but degraded HTML
   * on all subsequent requests can pass the validator while serving broken content
   * to real users.
   *
   * The gate decision is irrevocably made on the first request. Any degradation
   * that begins at request #2 — including the first real user request — is
   * invisible to the validator.
   *
   * Recommended fix: Issue at least two temporally-separated requests (e.g. with a
   * 2-second delay between them) and require both to pass. This raises the attack
   * cost from K=1 to K≥2 and catches common warm-up / degrade-after-first-render
   * patterns.
   */
  it("B1: first request clean, second request degraded → first call allowed=true, second call allowed=false (gap: gate uses only first call)", async () => {
    let requestCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      requestCount++;
      const html = requestCount === 1 ? CLEAN_HTML : ERROR_HTML;
      return Promise.resolve({ ok: true, status: 200, text: async () => html });
    });
    vi.stubGlobal("fetch", fetchMock);

    const firstResult = await domXray("https://example.com");
    const secondResult = await domXray("https://example.com");

    // First result (validator window): allowed — this is what the gate sees.
    expect(firstResult.allowed).toBe(true);
    // Second result (post-validation real-user traffic): blocked.
    expect(secondResult.allowed).toBe(false);
    // GAP-1: The validator makes its gate decision on firstResult alone.
    // A K=1 counter attack always lands in the clean window.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("B2: K=1 counter reset between runs — validator always encounters the clean first request", async () => {
    // Server resets its counter on each 'session' (simulated by always giving clean on odd calls).
    // Since domXray does exactly 1 fetch per call, it always sees the "first" request.
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      callCount++;
      // Attacker strategy: counter resets per unique call — always serve clean for single-fetch validators.
      const html = CLEAN_HTML;
      return Promise.resolve({ ok: true, status: 200, text: async () => html });
    }));

    // Validator calls domXray exactly once → always gets clean response.
    const result = await domXray("https://example.com");
    expect(result.allowed).toBe(true);
    // Single fetch confirmed — the entire attack surface is exploitable with K=1.
    expect(callCount).toBe(1);
  });

  it("B3: counter degrades at K=2 — validator passes, subsequent real-user requests fail", async () => {
    let count = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      count++;
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => count < 2 ? CLEAN_HTML : ERROR_HTML,
      });
    }));

    const validationResult = await domXray("https://example.com");
    expect(validationResult.allowed).toBe(true); // validator: count=1, clean

    // Simulate 3 subsequent user requests (count 2, 3, 4) — all degraded.
    for (let i = 0; i < 3; i++) {
      const userResult = await domXray("https://example.com");
      expect(userResult.allowed).toBe(false); // real users: count≥2, degraded
    }
    // Gap confirmed: validator passed at count=1; all post-deployment requests failed.
  });
});

// ─── C: dom-xray JS-execution blindness ──────────────────────────────────────

describe("C: dom-xray JS-execution blindness — static parse only (GAP-2)", () => {
  /**
   * GAP-2 (High) — JSDOM does not execute `<script>` tags.
   *
   * `dom-xray.ts` calls `new JSDOM(html)` without setting `runScripts: "dangerously"`.
   * In the default configuration, JSDOM parses the HTML structure but does not
   * execute any embedded JavaScript. This means:
   *
   * - `setTimeout(() => injectError(), 500)` — script is parsed but not run.
   *   No error element ever appears in the JSDOM document.
   * - `setTimeout(() => root.remove(), 500)` — root element remains present.
   * - Error elements added dynamically by React/Vue/Angular error boundaries are
   *   invisible if they are not server-rendered into the initial HTML.
   *
   * A component that renders cleanly in SSR but triggers a React error boundary
   * (which injects a `.error` element via JS) will pass dom-xray even if every
   * real user sees the error boundary.
   *
   * Recommended fix: Use a headless browser (Playwright/Puppeteer) with a
   * configurable post-render settling time (e.g. `page.waitForTimeout(2000)` after
   * `page.goto()`) to capture the post-JS-execution DOM state. This would catch
   * all deferred error patterns.
   */
  it("C1: HTML with deferred data-error injection script → JSDOM does not run script → allowed=true (GAP-2)", async () => {
    mockHtmlFetch(DEFERRED_ERROR_SCRIPT_HTML);
    const r = await domXray("https://example.com");
    // JSDOM static parse: script not executed, data-error element not injected.
    expect(r.errors).toBe(0);
    expect(r.hasRoot).toBe(true); // main#app present
    expect(r.allowed).toBe(true);
    // In a real browser after 500ms: data-error element would be present → blocked.
  });

  it("C2: HTML with script that removes #root after 500ms → JSDOM static parse sees root → allowed=true (GAP-2)", async () => {
    mockHtmlFetch(DEFERRED_ROOT_REMOVAL_HTML);
    const r = await domXray("https://example.com");
    // JSDOM: removal script not executed → main element still present.
    expect(r.hasRoot).toBe(true);
    expect(r.allowed).toBe(true);
    // In a real browser after 500ms: main removed → page appears blank.
  });

  it("C3: HTML with script that adds .error class element → not executed → errors=0 → allowed=true (GAP-2)", async () => {
    mockHtmlFetch(DEFERRED_CLASS_ERROR_HTML);
    const r = await domXray("https://example.com");
    // JSDOM: .error injection script not executed → errors=0.
    expect(r.errors).toBe(0);
    expect(r.hasRoot).toBe(true);
    expect(r.allowed).toBe(true);
    // In a real browser after 200ms: .error div present → blocked.
  });
});

// ─── D: dom-xray semantic gaps ───────────────────────────────────────────────

describe("D: dom-xray semantic gaps (GAP-3, GAP-4, DB-4)", () => {
  /**
   * GAP-3 (Medium) — Empty SPA shell passes as "healthy."
   *
   * `hasRoot` checks only that a root-selector element EXISTS in the document.
   * `<div id="root"></div>` — an empty React/Next.js SPA shell that relies on
   * client-side hydration to render any content — passes because:
   *   - `#root` found → hasRoot=true
   *   - No [data-error] or .error elements → errors=0
   *   - Result: allowed=true
   *
   * A real user loading this page sees a blank screen until JS executes.
   * Under a JS failure (CSP error, bundle 404, hydration error), the user sees
   * only the empty shell forever.
   *
   * Recommended fix: Check root element content — `rootEl.childElementCount > 0`
   * or `rootEl.textContent.trim().length > N` — to distinguish a meaningful
   * server-rendered response from an empty hydration shell.
   */
  it("D1: empty SPA shell <div id='root'></div> → hasRoot=true, errors=0 → allowed=true (GAP-3)", async () => {
    mockHtmlFetch(SPA_SHELL_HTML);
    const r = await domXray("https://example.com");
    expect(r.hasRoot).toBe(true);
    expect(r.errors).toBe(0);
    expect(r.allowed).toBe(true);
    // Gap: page renders blank for users without JS execution — dom-xray cannot distinguish
    // an empty shell from a fully server-rendered page.
  });

  it("D2: <main></main> with empty body → hasRoot=true, allowed=true despite zero content (GAP-3)", async () => {
    mockHtmlFetch("<html><head><title>App</title></head><body><main></main></body></html>");
    const r = await domXray("https://example.com");
    expect(r.hasRoot).toBe(true);
    expect(r.errors).toBe(0);
    expect(r.allowed).toBe(true);
  });

  /**
   * GAP-4 (Medium) — Bypass-header evasion.
   *
   * `domXray` sends `x-vercel-protection-bypass: <bypassSecret>` on every request.
   * A server that inspects this header can serve a "validator persona" (clean HTML)
   * exclusively to the validator and a degraded persona to all real users.
   *
   * Since dom-xray always includes the header, it can never observe the
   * production-user experience. The validator's result is structurally decoupled
   * from what real users receive.
   *
   * Recommended fix: Issue one request with the bypass header and one without;
   * compare the DOM structure and flag significant divergence (e.g. root element
   * present in header-response but absent in no-header response).
   */
  it("D3: bypass-header evasion — server returns clean HTML when header present, degraded when absent → validator always gets clean → allowed=true (GAP-4)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const bypassPresent = !!headers["x-vercel-protection-bypass"];
      const html = bypassPresent ? CLEAN_HTML : ERROR_HTML;
      return Promise.resolve({ ok: true, status: 200, text: async () => html });
    }));

    // Validator call: always sends bypass header → always gets clean HTML.
    const r = await domXray("https://example.com", "bypass-secret");
    expect(r.allowed).toBe(true);
    // Real users: no header → would see ERROR_HTML → blocked, but validator never knows.
  });

  /**
   * DB-4 — `[data-error]` selector is value-agnostic (documented false-positive risk).
   *
   * The CSS attribute selector `[data-error]` matches any element with a `data-error`
   * attribute, regardless of its value. `data-error="false"` or `data-error="0"` are
   * counted as errors. Frameworks that use `data-error` as a boolean-like attribute
   * with a falsy value will cause false positives.
   */
  it("DB-4: data-error='false' still counted as error (attribute selector is value-agnostic)", async () => {
    mockHtmlFetch(`<html><body><main>App</main><div data-error="false">No error here</div></body></html>`);
    const r = await domXray("https://example.com");
    // data-error="false" matches [data-error] → errors=1 → allowed=false (false positive).
    expect(r.errors).toBeGreaterThan(0);
    expect(r.allowed).toBe(false);
    // DB-4: this is a false-positive risk for frameworks that set data-error to falsy strings.
  });
});

// ─── E: shadow-traffic baseline ──────────────────────────────────────────────

describe("E: shadow-traffic baseline (existing behavior confirmed)", () => {
  it("E1: all three paths return 200 → allowed=true", async () => {
    mockStatusFetch(200);
    const r = await shadowTraffic("https://example.com");
    expect(r.allowed).toBe(true);
    expect(r.results).toHaveLength(3);
    expect(r.results.every((res) => res.status === 200)).toBe(true);
  });

  it("E2: one path returns 500 → bad=1 → allowed=false", async () => {
    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      callCount++;
      const status = url.includes("/api/health") ? 500 : 200;
      return Promise.resolve({ ok: status < 400, status });
    }));
    const r = await shadowTraffic("https://example.com");
    expect(r.allowed).toBe(false);
  });

  it("E3: /robots.txt returns 404 → 404 < 500 → still allowed=true (by design)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const status = url.endsWith("/robots.txt") ? 404 : 200;
      return Promise.resolve({ ok: status < 400, status });
    }));
    const r = await shadowTraffic("https://example.com");
    expect(r.allowed).toBe(true);
    // By design: shadow-traffic only flags 5xx. 404 is tolerated.
  });
});

// ─── F: shadow-traffic observation-window starvation ─────────────────────────

describe("F: shadow-traffic observation-window starvation — request-counter attack (GAP-5)", () => {
  /**
   * GAP-5 (High) — shadow-traffic single-shot 3-probe window.
   *
   * `shadowTraffic` issues exactly 3 concurrent requests per invocation. A server
   * that returns 200 for the first K requests and 500 for all subsequent ones can
   * pass the validator by setting K≥3. The validator's 3 concurrent probes all
   * land within the clean window; real user traffic begins after K is exhausted.
   *
   * This mirrors the Pass 33/34 production failure mode but at the traffic level:
   * the deployment gate passes, but the service begins failing immediately after.
   *
   * Recommended fix: Add a delayed re-probe (e.g. 3 probes at T=0, 3 more at T=5s)
   * and require both rounds to pass. This doubles the attack cost from K=3 to K=6
   * and catches common warm-up / graceful-degradation patterns.
   */
  it("F1: first 3 requests return 200, subsequent return 500 → validator probe lands in clean window → allowed=true (GAP-5)", async () => {
    let count = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      count++;
      const status = count <= 3 ? 200 : 500;
      return Promise.resolve({ ok: status < 400, status });
    }));

    const validationResult = await shadowTraffic("https://example.com");
    expect(validationResult.allowed).toBe(true); // probe 1,2,3 → all 200

    // Subsequent real-user calls (4th+ requests) → all 500.
    const postDeployResult = await shadowTraffic("https://example.com");
    expect(postDeployResult.allowed).toBe(false); // probes 4,5,6 → all 500
    // GAP-5: validation passed, post-deployment traffic fails.
  });

  it("F2: K=3 counter — validator always exhausts exactly the clean window", async () => {
    // Server allows exactly 3 requests before degrading.
    let count = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      count++;
      return Promise.resolve({ ok: count <= 3, status: count <= 3 ? 200 : 503 });
    }));

    const r = await shadowTraffic("https://example.com");
    // Exactly 3 concurrent probes — all 3 land in the clean window.
    expect(r.allowed).toBe(true);
    expect(count).toBe(3); // Confirms exactly 3 fetches made — K=3 exploitable.
  });

  /**
   * GAP-6 (Medium) — shadow-traffic bypass-header evasion.
   *
   * Like dom-xray, `shadowTraffic` always sends `x-vercel-protection-bypass` on
   * every probe. A server that returns 200 exclusively when this header is present
   * and 500 for all other traffic can pass shadow-traffic while serving a broken
   * service to real users.
   */
  it("F3: bypass-header evasion — 200 with bypass header, 500 without → validator passes, real users fail (GAP-6)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const hasHeader = !!headers["x-vercel-protection-bypass"];
      return Promise.resolve({ ok: hasHeader, status: hasHeader ? 200 : 503 });
    }));

    // Validator sends bypass header → 200 → allowed=true.
    const r = await shadowTraffic("https://example.com", "bypass-secret");
    expect(r.allowed).toBe(true);
    // Real users: no header → 503 → service down. Validator never observes this.
  });
});

// ─── G: shadow-traffic semantic gaps (path coverage) ─────────────────────────

describe("G: shadow-traffic path coverage gaps (GAP-7, GAP-8)", () => {
  /**
   * GAP-7 (Medium) — Only 3 hardcoded paths probed.
   *
   * `shadowTraffic` always probes exactly `["/", "/api/health", "/robots.txt"]`.
   * An application where these 3 paths work but critical app-specific paths fail
   * (e.g. `/api/users`, `/api/orders`, `/api/checkout`) will pass shadow-traffic
   * while real user-facing functionality is broken.
   *
   * This is especially acute for APIs where `/api/health` is a dedicated lightweight
   * health-check endpoint that bypasses the normal request handling stack. A backend
   * could return 200 on `/api/health` while `/api/users` returns 500 due to a
   * database connection failure.
   *
   * Recommended fix: Accept a configurable `paths` parameter in `shadowTraffic`
   * so callers can supply app-specific critical paths. Default to the current 3 for
   * backwards compatibility.
   */
  it("G1: the 3 monitored paths return 200 but a critical app path would return 500 → allowed=true (GAP-7)", async () => {
    // Server: /, /api/health, /robots.txt → 200; /api/data → 500.
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const problematic = url.includes("/api/data");
      return Promise.resolve({ ok: !problematic, status: problematic ? 500 : 200 });
    }));

    // shadow-traffic never probes /api/data → doesn't detect the 500.
    const r = await shadowTraffic("https://example.com");
    expect(r.allowed).toBe(true);
    expect(r.results.map((x) => x.status)).toEqual([200, 200, 200]);
    // Gap: /api/data → 500 is invisible; only the 3 hardcoded paths are inspected.
  });

  it("G2: /api/health always 200 (lightweight health check bypasses DB stack) while /api/users → 500 → allowed=true (GAP-7)", async () => {
    // Common pattern: /api/health is a dedicated endpoint; /api/users hits the DB.
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const isHealth = url.includes("/api/health") || url.endsWith("/") || url.includes("/robots.txt");
      return Promise.resolve({ ok: isHealth, status: isHealth ? 200 : 500 });
    }));

    const r = await shadowTraffic("https://example.com");
    expect(r.allowed).toBe(true); // health check and root pass
    // Database-backed endpoints are unmonitored — app appears healthy while /api/users fails.
  });

  /**
   * GAP-8 (Low) — /robots.txt 404 reduces effective probe coverage to 2 paths.
   *
   * Many applications do not serve `/robots.txt`. A 404 response is < 500 and
   * therefore passes shadow-traffic. In practice, the effective health check is
   * reduced to `["/", "/api/health"]` — 2 paths instead of 3 — without any
   * indication or warning. This is the documented minimum effective coverage.
   */
  it("G3: /robots.txt returns 404, effective coverage reduced to 2 paths — validator still passes (GAP-8)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      const status = url.includes("/robots.txt") ? 404 : 200;
      return Promise.resolve({ ok: status < 400, status });
    }));

    const r = await shadowTraffic("https://example.com");
    expect(r.allowed).toBe(true);
    const robotsResult = r.results.find((x) => x.path === "/robots.txt");
    expect(robotsResult?.status).toBe(404);
    // Gap: /robots.txt 404 is silent — shadow-traffic treats it as non-error and emits no warning
    // about reduced path coverage.
  });
});

// ─── H: Design boundaries / combined attack surface ──────────────────────────

describe("H: Design boundaries and combined attack surface", () => {
  /**
   * DB-1 — dom-xray is a static HTML snapshot.
   *
   * The single-fetch, single-parse architecture means that dom-xray's result
   * is a property of exactly one HTTP response at one point in time. Any server
   * behavior that is not visible in that one response — whether deferred (JS
   * execution), subsequent (request-counter), or conditional (bypass-header) —
   * is structurally invisible to the validator.
   */
  it("H1: DB-1 — dom-xray result is entirely determined by a single HTTP response; all post-fetch degradation is invisible", async () => {
    let fetchCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      fetchCount++;
      return Promise.resolve({ ok: true, status: 200, text: async () => CLEAN_HTML });
    }));

    await domXray("https://example.com");
    expect(fetchCount).toBe(1); // Exactly one fetch per domXray call — DB-1 confirmed.
  });

  /**
   * DB-2 — shadow-traffic gate is exactly 3 concurrent probes at one instant.
   *
   * Three concurrent requests share the same moment in the server's request
   * lifecycle. They cannot detect:
   * - Load-based degradation (only observable under sustained traffic, not 3 simultaneous requests)
   * - Time-delayed degradation (only observable after a settling period)
   * - Counter-based degradation at K>3
   */
  it("H2: DB-2 — shadow-traffic issues exactly 3 fetch calls per invocation; gate is entirely determined by those 3 responses", async () => {
    let count = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => {
      count++;
      return Promise.resolve({ ok: true, status: 200 });
    }));

    await shadowTraffic("https://example.com");
    expect(count).toBe(3); // Exactly 3 probes — DB-2 confirmed.
  });

  /**
   * DB-3 — Combined bypass-header attack defeats both validators simultaneously.
   *
   * Both dom-xray and shadow-traffic send `x-vercel-protection-bypass` on every
   * request. A single server-side check on this header can simultaneously serve
   * a clean DOM to dom-xray AND return 200 on all shadow-traffic probes, while
   * serving broken HTML and 500s to all real users. The two validators share the
   * same structural blind spot — a single server-side conditional defeats both
   * in one deployment.
   */
  it("H3: DB-3 — bypass-header attack simultaneously defeats dom-xray and shadow-traffic", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const isValidator = !!headers["x-vercel-protection-bypass"];

      if (isValidator) {
        // Validator persona: clean DOM + 200 status.
        return Promise.resolve({
          ok: true,
          status: 200,
          text: async () => CLEAN_HTML,
        });
      } else {
        // Real-user persona: broken DOM + 500 status.
        return Promise.resolve({
          ok: false,
          status: 500,
          text: async () => ERROR_HTML,
        });
      }
    }));

    // dom-xray: sends bypass header → gets clean HTML → allowed=true.
    const domResult = await domXray("https://example.com", "bypass-secret");
    expect(domResult.allowed).toBe(true);

    // shadow-traffic: sends bypass header → gets 200 on all probes → allowed=true.
    const trafficResult = await shadowTraffic("https://example.com", "bypass-secret");
    expect(trafficResult.allowed).toBe(true);

    // DB-3: both validators passed. A real user (no header) would receive
    // status=500 and ERROR_HTML. The deployment gate is fully bypassed.
  });
});
