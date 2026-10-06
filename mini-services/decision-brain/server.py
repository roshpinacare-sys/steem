"""decision-brain — r162 sovereign fleet service (port 3047).

Wraps the laya (Apache-2.0) non-autoregressive decision engine as an HTTP
service. System-1 fast triage: typed decisions (choice / score / noul) in a
single forward pass, no text generation, no LLM tokens, works fully offline
after the one-time checkpoint download.

Memory safety: the sandbox fleet shares ~4GB RAM. The checkpoint (~2GB RSS
while resident) is loaded lazily on the first /decide and unloaded after
LAYA_IDLE_UNLOAD seconds of silence (default 120).

Endpoints:
  GET  /health  -> {ok, loaded, model, idle_unload_s, since_decision_s}
  POST /decide  -> body {state, questions, model?, max_len?}
                   -> full laya result (routing + answers), or error JSON
"""
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 3047
DEFAULT_MODEL = os.environ.get("LAYA_MODEL", "multilingual")
IDLE_UNLOAD_S = int(os.environ.get("LAYA_IDLE_UNLOAD", "120"))
MAX_BODY = 256 * 1024

_lock = threading.Lock()          # guards router + state below
_router = None                    # laya.Router, created on first use
_loaded_at = 0.0
_last_decision_at = 0.0
_decisions_served = 0


def _get_router():
    """Lazy import + construct. Download (~644MB) happens once, then cached."""
    global _router, _loaded_at
    if _router is None:
        from laya import Router  # heavy import deferred
        _router = Router(max_loaded=1)
        _loaded_at = time.time()
    return _router


def _reaper():
    """Unload resident checkpoints when idle to return memory to the fleet."""
    global _router
    while True:
        time.sleep(15)
        with _lock:
            if _router is not None and _last_decision_at > 0 \
                    and time.time() - _last_decision_at > IDLE_UNLOAD_S:
                try:
                    _router.unload()
                except Exception:
                    pass
                _router = None


class Handler(BaseHTTPRequestHandler):
    server_version = "decision-brain/0.1.0"

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/health":
            return self._send(404, {"ok": False, "error": "not_found"})
        with _lock:
            since = round(time.time() - _last_decision_at, 1) if _last_decision_at else None
            return self._send(200, {
                "ok": True, "service": "decision-brain",
                "engine": "laya 0.3.24 (Apache-2.0)",
                "loaded": _router is not None, "default_model": DEFAULT_MODEL,
                "idle_unload_s": IDLE_UNLOAD_S,
                "decisions_served": _decisions_served,
                "since_decision_s": since,
            })

    def do_POST(self):
        global _last_decision_at, _decisions_served
        if self.path != "/decide":
            return self._send(404, {"ok": False, "error": "not_found"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > MAX_BODY:
                return self._send(413, {"ok": False, "error": "body_size_out_of_range"})
            req = json.loads(self.rfile.read(n).decode("utf-8"))
            state = req.get("state")
            questions = req.get("questions")
            if not isinstance(state, str) or not state.strip() \
                    or not isinstance(questions, dict) or not questions:
                return self._send(400, {"ok": False,
                                        "error": "state:string and questions:dict required"})
            with _lock:
                t0 = time.time()
                router = _get_router()
                result = router.predict(
                    state, questions,
                    model=req.get("model", DEFAULT_MODEL),
                    max_len=req.get("max_len"),
                )
                _last_decision_at = time.time()
                _decisions_served += 1
                return self._send(200, {
                    "ok": True,
                    "took_ms": round((time.time() - t0) * 1000, 1),
                    "result": result,
                })
        except json.JSONDecodeError:
            return self._send(400, {"ok": False, "error": "invalid_json"})
        except Exception as exc:  # noqa: BLE001 — surface any engine failure as JSON
            return self._send(500, {"ok": False, "error": str(exc)[:300]})

    def log_message(self, fmt, *args):  # quiet: keep dev.log small
        pass


if __name__ == "__main__":
    threading.Thread(target=_reaper, daemon=True).start()
    print(f"[decision-brain] listening on :{PORT} model={DEFAULT_MODEL} "
          f"idle_unload={IDLE_UNLOAD_S}s", flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
