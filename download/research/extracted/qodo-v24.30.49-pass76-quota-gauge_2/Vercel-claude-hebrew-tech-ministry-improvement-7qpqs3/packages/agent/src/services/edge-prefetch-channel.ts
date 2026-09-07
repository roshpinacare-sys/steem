import { log } from "./logger.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";
/**
 * edge-prefetch-channel.ts
 *
 * Client-assisted distributed caching via WebRTC + Redis Pub/Sub.
 *
 * Flow:
 *   CLI side  — publishes a prefetch request to Redis channel "qodo:prefetch:req".
 *               Waits up to PEER_TIMEOUT_MS for a DataChannel reply.
 *               Falls back to a direct GitHub API call if no peer responds.
 *
 *   UI side   — subscribes to "qodo:prefetch:req" via Redis Pub/Sub (SSE bridge).
 *               On receiving a request: fetches the file through the Worker's
 *               /prefetch-content proxy (which holds the GitHub token
 *               server-side — see Pass 43 T1 fix), caches it in an in-memory
 *               Map, then sends the content back to the CLI over a WebRTC
 *               DataChannel.
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface PrefetchRequest {
  requestId: string;
  owner: string;
  repo: string;
  path: string;
  ref: string;
}

export interface PrefetchResponse {
  requestId: string;
  content: string;
  fromCache: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// CLI-side: EdgePrefetchClient
// ---------------------------------------------------------------------------

const PEER_TIMEOUT_MS = 4_000;
// Bug 17-A fix: the CLI publishes offers on the same Redis channel that the
// Cloudflare Worker telemetry-proxy SSE bridge polls.  Previously the client
// used "qodo:prefetch:req" while the worker read "qodo:prefetch:signals",
// so offers never reached Mission Control and peer-assisted prefetch always
// fell back to the GitHub API.
// Bug 18-A fix: all Redis keys now live under the qodo:v24: namespace per
// SYSTEM-INVARIANTS.md rule 3.
const REDIS_CHANNEL   = "qodo:v24:prefetch:signals";

/**
 * CLI-side prefetch client.
 *
 * Usage:
 *   const client = new EdgePrefetchClient(redisPublish, githubApiToken);
 *   const content = await client.fetch(owner, repo, path, ref);
 */
export class EdgePrefetchClient {
  /** Inject a Redis publish function (wraps your RedisState.publish). */
  private readonly publishFn: (channel: string, message: string) => Promise<void>;
  /** GitHub token used for direct API fallback. */
  private readonly githubToken: string;
  /** In-flight peer connections keyed by requestId. */
  private readonly peers = new Map<string, RTCPeerConnection>();
  /** Pending response resolvers keyed by requestId. */
  private readonly pending = new Map<string, (res: PrefetchResponse) => void>();

  constructor(
    publishFn: (channel: string, message: string) => Promise<void>,
    githubToken: string,
  ) {
    this.publishFn   = publishFn;
    this.githubToken = githubToken;
  }

  /**
   * Fetch a file from a peer browser cache or fall back to GitHub API.
   */
  async fetch(owner: string, repo: string, path: string, ref = "HEAD"): Promise<string> {
    const requestId = crypto.randomUUID();
    const req: PrefetchRequest = { requestId, owner, repo, path, ref };

    // Attempt peer-assisted fetch via WebRTC.
    const peerResult = await this._requestFromPeer(req);
    if (peerResult !== null) return peerResult;

    // Fallback: direct GitHub Contents API call.
    log.info('edge-prefetch: no peer responded; falling back to GitHub API', { path });
    return this._githubFallback(owner, repo, path, ref);
  }

  /** Publish the request to Redis and wait for a DataChannel response. */
  private async _requestFromPeer(req: PrefetchRequest): Promise<string | null> {
    // Only attempt WebRTC in a browser context.
    if (typeof RTCPeerConnection === "undefined") return null;

    return new Promise<string | null>((resolve) => {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      this.peers.set(req.requestId, pc);

      // DataChannel for receiving the cached file.
      const dc = pc.createDataChannel("prefetch");
      dc.onmessage = (evt) => {
        try {
          const res: PrefetchResponse = JSON.parse(evt.data as string);
          if (res.requestId === req.requestId) {
            const resolver = this.pending.get(req.requestId);
            resolver?.(res);
          }
        } catch {
          // ignore malformed messages
        }
      };

      // Register the pending resolver.
      this.pending.set(req.requestId, (res) => {
        this._cleanup(req.requestId);
        if (res.error) {
          resolve(null);
        } else {
          resolve(res.content);
        }
      });

      // Publish signaling message to Redis so the UI side can connect.
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => {
          const signal = JSON.stringify({
            type: "offer",
            sdp: pc.localDescription,
            requestId: req.requestId,
            request: req,
          });
          return this.publishFn(REDIS_CHANNEL, signal);
        })
        .catch(() => {
          this._cleanup(req.requestId);
          resolve(null);
        });

      // Timeout: fall back to GitHub API if no peer answers in time.
      setTimeout(() => {
        if (this.pending.has(req.requestId)) {
          this._cleanup(req.requestId);
          resolve(null);
        }
      }, PEER_TIMEOUT_MS);
    });
  }

  /** Accept a WebRTC answer SDP from the UI peer. */
  async acceptAnswer(requestId: string, answerSdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.peers.get(requestId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(answerSdp));
  }

  private _cleanup(requestId: string): void {
    this.peers.get(requestId)?.close();
    this.peers.delete(requestId);
    this.pending.delete(requestId);
  }

  /** Direct GitHub Contents API fallback. */
  private async _githubFallback(
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string> {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
    const r = await fetchWithTimeout(
      url,
      {
        headers: {
          Authorization: `Bearer ${this.githubToken}`,
          Accept: "application/vnd.github.v3.raw",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
      30_000,
    );
    if (!r.ok) throw new Error(`GitHub API ${r.status} for ${path}`);
    return r.text();
  }
}

// ---------------------------------------------------------------------------
// UI-side: EdgePrefetchServer
// ---------------------------------------------------------------------------

/** Browser-side in-memory file cache. */
const _browserCache = new Map<string, string>();

/**
 * UI-side prefetch server.
 *
 * The Mission Control app instantiates one of these with the Worker proxy
 * URL and a `getSessionToken` callback (see `utils/session.ts`).
 * The server listens for Redis Pub/Sub signals via a Server-Sent Events bridge,
 * fetches requested files through the Worker's `/prefetch-content` route
 * (which holds the actual GitHub token server-side — see Pass 43 T1 fix),
 * caches them, and returns them to the CLI peer over a WebRTC DataChannel.
 */
export class EdgePrefetchServer {
  private readonly proxyUrl: string;
  private readonly getSessionToken: () => Promise<string>;
  private eventSource: EventSource | null = null;

  constructor(proxyUrl: string, getSessionToken: () => Promise<string>) {
    this.proxyUrl = proxyUrl;
    this.getSessionToken = getSessionToken;
  }

  /**
   * Start listening for prefetch requests.
   * @param sseUrl  URL of the SSE bridge that replays Redis channel messages
   *                (e.g. `${PROXY_URL}/prefetch-signals`).
   */
  async listen(sseUrl: string): Promise<void> {
    if (this.eventSource) this.eventSource.close();
    const token = await this.getSessionToken();
    const url = `${sseUrl}?session=${encodeURIComponent(token)}`;
    this.eventSource = new EventSource(url);
    this.eventSource.onmessage = (evt) => this._handleSignal(evt.data as string);
    this.eventSource.onerror = () =>
      log.warn("edge-prefetch-server: SSE connection error; will retry");
  }

  stop(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

  private async _handleSignal(raw: string): Promise<void> {
    let signal: {
      type: string;
      sdp: RTCSessionDescriptionInit;
      requestId: string;
      request: PrefetchRequest;
    };
    try {
      signal = JSON.parse(raw);
    } catch {
      return;
    }
    if (signal.type !== "offer") return;

    const { requestId, request, sdp } = signal;

    // Fetch (or serve from cache) the requested file.
    const cacheKey = `${request.owner}/${request.repo}/${request.path}@${request.ref}`;
    let content = _browserCache.get(cacheKey) ?? null;
    const fromCache = content !== null;

    if (!fromCache) {
      try {
        content = await this._fetchFromGitHub(request);
        _browserCache.set(cacheKey, content);
      } catch (e: unknown) {
        const err = e instanceof Error ? e.message : String(e);
        log.warn('edge-prefetch-server: fetch failed', { path: request.path, error: String(err) });
        content = null;
      }
    }

    const response: PrefetchResponse = content !== null
      ? { requestId, content, fromCache }
      : { requestId, content: "", fromCache: false, error: "fetch failed" };

    // Create a peer connection and answer the CLI's offer.
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

    pc.ondatachannel = (evt) => {
      const dc = evt.channel;
      dc.onopen = () => {
        dc.send(JSON.stringify(response));
        dc.close();
        pc.close();
      };
    };

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // The answer SDP must be routed back to the CLI via the signaling channel.
    // In production this is done through the same Redis Pub/Sub bridge.
    // Emit a custom DOM event so the app layer can forward it.
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("qodo:prefetch:answer", {
          detail: { requestId, answerSdp: pc.localDescription },
        }),
      );
    }
  }

  private async _fetchFromGitHub(req: PrefetchRequest): Promise<string> {
    // Routed through the Worker's /prefetch-content proxy so the browser
    // never holds a GitHub token (Pass 43 T1 fix).
    const token = await this.getSessionToken();
    const params = new URLSearchParams({
      owner: req.owner,
      repo: req.repo,
      path: req.path,
      ref: req.ref,
    });
    const r = await fetchWithTimeout(
      `${this.proxyUrl}/prefetch-content?${params.toString()}`,
      { headers: { "X-Qodo-Session": token } },
      30_000,
    );
    if (!r.ok) throw new Error(`prefetch-content ${r.status}`);
    const data = (await r.json()) as { content: string };
    return data.content;
  }
}
