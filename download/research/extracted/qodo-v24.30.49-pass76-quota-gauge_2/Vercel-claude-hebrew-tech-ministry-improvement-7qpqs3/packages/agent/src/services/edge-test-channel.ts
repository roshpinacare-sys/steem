import { RedisState } from "./redis-state.js";
import type { Telemetry } from "./telemetry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestRunRequest {
  /** Relative file paths included in the patch under test. */
  files: string[];
  /** Shell command to execute, e.g. "npm test". */
  command: string;
}

export interface TestRunResult {
  /** True when the test command exited with code 0. */
  exitCode: number;
  /** Accumulated stdout/stderr from the remote runner. */
  output: string;
}

// ---------------------------------------------------------------------------
// Signaling channel keys
// ---------------------------------------------------------------------------

const OFFER_CHANNEL  = "qodo:p2p:offer";
const ANSWER_CHANNEL = "qodo:p2p:answer:";   // + sessionId suffix

// ---------------------------------------------------------------------------
// WebRTC abstraction (graceful degradation in Node.js)
// ---------------------------------------------------------------------------

/**
 * Minimal interface for the subset of RTCPeerConnection we use.
 * Allows the module to compile and run in Node.js where `RTCPeerConnection`
 * is absent, while still being fully typed.
 */
interface RTCLike {
  createDataChannel(label: string): RTCDataChannelLike;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void>;
  localDescription: RTCSessionDescriptionInit | null;
  onicecandidate: ((e: { candidate: RTCIceCandidateInit | null }) => void) | null;
  close(): void;
}

interface RTCDataChannelLike {
  send(data: string): void;
  close(): void;
  onopen:    ((e: Event) => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onerror:   ((e: Event) => void) | null;
  onclose:   ((e: Event) => void) | null;
  readyState: string;
}

function createRTCPeerConnection(config: RTCConfiguration): RTCLike | null {
  // CORRECTION (V24 audit): RTCPeerConnection is available natively in
  // browser runtimes only. There is no Node.js flag that adds it — Node.js
  // has never shipped native WebRTC, in any version. In the actual deployment
  // target (a plain Node.js GitHub Actions runner) globalThis.RTCPeerConnection
  // is always undefined, so this function always returns null and the CLI side
  // always falls back to local execution as currently shipped. Making this
  // path real on the CLI/runner side would require adding an actual userland
  // WebRTC implementation (e.g. `@roamhq/wrtc` or `werift`) as a dependency —
  // neither is currently declared in package.json. The browser (Mission
  // Control) side works fine as-is since RTCPeerConnection is a native
  // browser API there.
  try {
    if (typeof globalThis.RTCPeerConnection !== "undefined") {
      return new globalThis.RTCPeerConnection(config) as unknown as RTCLike;
    }
  } catch {
    // ignore — not available
  }
  return null;
}

// ---------------------------------------------------------------------------
// EdgeTestClient
// ---------------------------------------------------------------------------

/**
 * Sends a TestRunRequest to a waiting Mission Control UI peer over a WebRTC
 * DataChannel.  Signaling is bootstrapped through Redis Pub/Sub so no
 * dedicated signaling server is required.
 *
 * Lifecycle:
 *   1. Publish offer SDP + sessionId to `qodo:p2p:offer`.
 *   2. Poll `qodo:p2p:answer:<sessionId>` for the UI peer's answer SDP.
 *   3. Open a DataChannel, send the serialised TestRunRequest.
 *   4. Stream stdout chunks back until a `{"done":true}` sentinel arrives.
 *   5. Resolve with TestRunResult.
 *
 * Returns `null` when WebRTC is unavailable or no peer answers within
 * `peerTimeoutMs` so callers can fall back to local execution.
 */
export class EdgeTestClient {
  private readonly state: RedisState;
  private readonly telemetry: Telemetry | undefined;

  constructor(state: RedisState, telemetry?: Telemetry) {
    this.state = state;
    this.telemetry = telemetry;
  }

  async send(
    request: TestRunRequest,
    peerTimeoutMs = 8_000,
    runTimeoutMs  = 120_000,
  ): Promise<TestRunResult | null> {
    const sessionId = crypto.randomUUID();

    const pc = createRTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    if (!pc) {
      await this.telemetry?.decision("edge-test-channel", "webrtc-unavailable", { sessionId });
      return null;
    }

    try {
      return await this._runSession(pc, sessionId, request, peerTimeoutMs, runTimeoutMs);
    } finally {
      pc.close();
    }
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async _runSession(
    pc: RTCLike,
    sessionId: string,
    request: TestRunRequest,
    peerTimeoutMs: number,
    runTimeoutMs: number,
  ): Promise<TestRunResult | null> {
    const dc = pc.createDataChannel("test-run");

    // Gather ICE candidates before publishing the offer.
    const localDesc = await this._gatherOffer(pc);
    if (!localDesc) return null;

    // Publish offer via Redis so the Mission Control UI peer can pick it up.
    await this.state.publish(
      OFFER_CHANNEL,
      JSON.stringify({ sessionId, sdp: localDesc }),
    );
    await this.telemetry?.decision("edge-test-channel", "offer-published", { sessionId });

    // Wait for an answer SDP from the peer.
    const answer = await this._pollForAnswer(sessionId, peerTimeoutMs);
    if (!answer) {
      await this.telemetry?.decision("edge-test-channel", "no-peer-answered", { sessionId });
      return null;
    }

    await pc.setRemoteDescription(answer);

    // Wait for DataChannel to open, then run the test.
    return this._runOverChannel(dc, request, runTimeoutMs, sessionId);
  }

  /** Create offer and wait for ICE gathering to complete (or 3s timeout). */
  private async _gatherOffer(pc: RTCLike): Promise<RTCSessionDescriptionInit | null> {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // Wait up to 3 s for ICE candidates to be appended to localDescription.
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 3_000);
        pc.onicecandidate = (e) => {
          if (e.candidate === null) {
            clearTimeout(timeout);
            resolve();
          }
        };
      });
      return pc.localDescription;
    } catch {
      return null;
    }
  }

  /** Poll the Redis answer key at 200 ms intervals until timeout. */
  private async _pollForAnswer(
    sessionId: string,
    timeoutMs: number,
  ): Promise<RTCSessionDescriptionInit | null> {
    const key = `${ANSWER_CHANNEL}${sessionId}`;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const raw = await this.state.rpop(key).catch(() => null);
      if (raw) {
        try {
          return JSON.parse(raw) as RTCSessionDescriptionInit;
        } catch {
          return null;
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    return null;
  }

  /** Send the request over the DataChannel and collect streamed stdout. */
  private _runOverChannel(
    dc: RTCDataChannelLike,
    request: TestRunRequest,
    timeoutMs: number,
    sessionId: string,
  ): Promise<TestRunResult | null> {
    return new Promise((resolve) => {
      let outputBuffer = "";
      const timer = setTimeout(() => {
        dc.close();
        resolve(null);
      }, timeoutMs);

      dc.onopen = () => {
        dc.send(JSON.stringify(request));
        this.telemetry?.decision("edge-test-channel", "request-sent", { sessionId });
      };

      dc.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as { done?: boolean; exitCode?: number; chunk?: string };
          if (msg.done) {
            clearTimeout(timer);
            dc.close();
            resolve({ exitCode: msg.exitCode ?? 1, output: outputBuffer });
          } else if (msg.chunk) {
            outputBuffer += msg.chunk;
          }
        } catch {
          outputBuffer += e.data;
        }
      };

      dc.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };

      dc.onclose = () => {
        clearTimeout(timer);
        // Resolve as null only if we haven't already resolved with a result.
        resolve(null);
      };
    });
  }
}
