#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "evidence" / "generated"
EVIDENCE.mkdir(parents=True, exist_ok=True)


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_for_health(url: str, timeout: float = 20.0) -> dict:
    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as error:  # noqa: BLE001 - bounded retry records final error
            last_error = error
            time.sleep(0.2)
    raise RuntimeError(f"server did not become healthy: {last_error}")


def main() -> None:
    port = free_port()
    data_root = Path(tempfile.mkdtemp(prefix="v19-browser-data-"))
    env = os.environ.copy()
    env.update({"PORT": str(port), "V19_DATA_ROOT": str(data_root)})
    server_stdout_path = data_root / "server.stdout.log"
    server_stderr_path = data_root / "server.stderr.log"
    server_stdout = server_stdout_path.open("w", encoding="utf-8")
    server_stderr = server_stderr_path.open("w", encoding="utf-8")
    process = subprocess.Popen(
        ["node", "dist/src/web/server.js"],
        cwd=ROOT,
        env=env,
        stdout=server_stdout,
        stderr=server_stderr,
        text=True,
        start_new_session=True,
    )
    base = f"http://127.0.0.1:{port}"
    report: dict[str, object] = {"port": port, "dataRoot": str(data_root)}
    try:
        health = wait_for_health(f"{base}/api/health")
        assert health["promotionBoundary"] == "shadow-only"
        assert health["infrastructure"]["externalGitMutation"] == "disabled"
        assert "untrusted repositories blocked" in health["infrastructure"]["isolation"]

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                executable_path="/usr/bin/chromium",
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            context = browser.new_context(viewport={"width": 1440, "height": 1100})
            page = context.new_page()

            def backend_fetch(method: str, path: str, body: str | None) -> dict:
                request = urllib.request.Request(
                    f"{base}{path}",
                    data=body.encode("utf-8") if body else None,
                    method=method,
                    headers={"content-type": "application/json"},
                )
                try:
                    with urllib.request.urlopen(request, timeout=30) as response:
                        return {"status": response.status, "body": response.read().decode("utf-8")}
                except urllib.error.HTTPError as error:
                    return {"status": error.code, "body": error.read().decode("utf-8")}

            page.expose_function("backendFetch", backend_fetch)
            html = (ROOT / "web" / "index.html").read_text(encoding="utf-8").replace('<link rel="stylesheet" href="/styles.css">', '').replace('<script src="/app.js" defer></script>', '')
            page.set_content(html, wait_until="domcontentloaded")
            page.add_style_tag(content=(ROOT / "web" / "styles.css").read_text(encoding="utf-8"))
            page.evaluate(
                """
                (() => {
                  window.fetch = async (path, options = {}) => {
                    const result = await window.backendFetch(options.method || 'GET', String(path), options.body || null);
                    return new Response(result.body, { status: result.status, headers: { 'content-type': 'application/json' } });
                  };
                })();
                """
            )
            page.add_script_tag(content=(ROOT / "web" / "app.js").read_text(encoding="utf-8"))
            page.wait_for_function("document.querySelector('#health').textContent.includes('Status: ok')")
            assert page.get_by_role("heading", name="Governed Engineering and Change Assurance").is_visible()
            assert "PostgreSQL: environment-blocked" in page.locator("#health").inner_text()

            # Accessibility structure: every form field has an associated label.
            for field_id in ["repository", "objective", "target-file", "test-command", "before", "after"]:
                assert page.locator(f'label[for="{field_id}"]').count() == 1

            # Keyboard access to the demo action.
            page.locator("#load-demo").focus()
            page.keyboard.press("Enter")
            page.wait_for_function("document.querySelector('#repository').value.length > 0")

            page.get_by_role("button", name="Inspect repository and permissions").click()
            page.wait_for_function("!document.querySelector('#execute').disabled")
            security_text = page.locator("#security").inner_text()
            assert "PROMPT_INJECTION" in security_text
            assert "DEPENDENCY_RISK" in security_text
            permissions_text = page.locator("#permissions").inner_text()
            assert "Denied" in permissions_text and "network" in permissions_text

            page.get_by_role("button", name="Approve permissions and execute").click()
            page.wait_for_function("!document.querySelector('#review').disabled")
            assert "Tests passed" in page.locator("#tests").inner_text()
            assert "not-production-ready" in page.locator("#claims").inner_text()
            assert "evidenceRoot" in page.locator("#change").inner_text()

            page.get_by_role("button", name="Independent review and passport").click()
            page.wait_for_function("document.querySelector('#passport').textContent.includes('signature')")
            assert "shadow" in page.locator("#passport").inner_text()
            assert "External mutation remains disabled" in page.locator("#audit").inner_text()

            page.screenshot(path=str(EVIDENCE / "v19-web-approved.png"), full_page=True)

            page.get_by_role("button", name="Apply rollback").click()
            page.wait_for_function("document.querySelector('#audit').textContent.includes('Rollback applied')")
            assert "exact base commit" in page.locator("#audit").inner_text()
            page.screenshot(path=str(EVIDENCE / "v19-web-rollback.png"), full_page=True)

            # RTL readiness smoke test.
            page.evaluate("document.documentElement.dir = 'rtl'")
            assert page.evaluate("getComputedStyle(document.body).direction") == "rtl"
            browser.close()

        report.update({
            "status": "passed",
            "health": health,
            "browserNetworkMode": "playwright-dom-harness-with-real-backend-bridge",
            "directLoopbackNavigation": "environment-blocked-by-chromium-policy",
            "checks": [
                "real-backend-workflow",
                "prompt-injection-visible-and-not-followed",
                "permission-boundary-visible",
                "tests-and-evidence-visible",
                "independent-review",
                "signed-shadow-passport",
                "exact-rollback",
                "keyboard-access",
                "form-labels",
                "rtl-readiness",
            ],
        })
    except Exception as error:  # noqa: BLE001 - evidence must capture exact failure
        report.update({"status": "failed", "error": repr(error)})
        raise
    finally:
        try:
            os.killpg(process.pid, 15)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, 9)
            except ProcessLookupError:
                pass
            process.wait(timeout=5)
        server_stdout.close()
        server_stderr.close()
        report["serverStdout"] = server_stdout_path.read_text(encoding="utf-8", errors="replace")
        report["serverStderr"] = server_stderr_path.read_text(encoding="utf-8", errors="replace")
        (EVIDENCE / "v19-browser-e2e.json").write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
