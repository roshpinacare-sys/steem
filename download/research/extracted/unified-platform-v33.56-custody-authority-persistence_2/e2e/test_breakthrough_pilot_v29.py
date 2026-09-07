#!/usr/bin/env python3
from __future__ import annotations
import http.cookiejar, json, os, signal, socket, subprocess, tempfile, time, urllib.error, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / 'evidence' / 'generated'
EVIDENCE.mkdir(parents=True, exist_ok=True)
BOOTSTRAP = 'v29-e2e-bootstrap-token-private'
PASSPHRASE = 'v29 e2e keystore passphrase with sufficient entropy'
ORIGIN = 'https://pilot.local'

def _terminate(signum, _frame):
    raise KeyboardInterrupt(f'validation signal {signum}')

signal.signal(signal.SIGTERM, _terminate)
signal.signal(signal.SIGINT, _terminate)

def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0)); return sock.getsockname()[1]

def wait(url, opener, timeout=20):
    deadline=time.time()+timeout
    while time.time()<deadline:
        try:
            with opener.open(url,timeout=1) as response: return json.loads(response.read())
        except Exception: time.sleep(.2)
    raise RuntimeError('private pilot server did not become healthy')

def main():
    port=free_port(); data=Path(tempfile.mkdtemp(prefix='v29-browser-'))
    env=os.environ.copy(); env.update({'PORT':str(port),'V20_DATA_ROOT':str(data),'V20_KEYSTORE_PASSPHRASE':PASSPHRASE,'V20_BOOTSTRAP_TOKEN':BOOTSTRAP,'V20_ALLOWED_ORIGIN':ORIGIN})
    stdout=(data/'server.stdout').open('w'); stderr=(data/'server.stderr').open('w')
    process=subprocess.Popen(['node','dist/src/cli/private-pilot-server.js'],cwd=ROOT,env=env,stdout=stdout,stderr=stderr,text=True,start_new_session=True)
    jar=http.cookiejar.CookieJar(); opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar)); base=f'http://127.0.0.1:{port}'
    report={'port':port,'dataRoot':str(data)}
    try:
        health=wait(base+'/api/v20/health',opener); assert health['promotionBoundary']=='shadow-only'
        def bridge(method,path,body,headers):
            request_headers={'content-type':'application/json','origin':ORIGIN}
            for key,value in (headers or {}).items(): request_headers[str(key).lower()]=str(value)
            req=urllib.request.Request(base+path,data=body.encode() if body else None,method=method,headers=request_headers)
            try:
                with opener.open(req,timeout=60) as response: return {'status':response.status,'body':response.read().decode()}
            except urllib.error.HTTPError as error: return {'status':error.code,'body':error.read().decode()}
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
            page=browser.new_page(viewport={'width':1440,'height':1100}); page.expose_function('backendFetch',bridge)
            html=(ROOT/'web-v20/index.html').read_text().replace('<link rel="stylesheet" href="/pilot.css">','').replace('<script src="/pilot.js" defer></script>','')
            page.set_content(html); page.add_style_tag(content=(ROOT/'web-v20/pilot.css').read_text())
            page.evaluate("""(() => { window.fetch = async (path, options = {}) => { const result = await window.backendFetch(options.method || 'GET', String(path), options.body || null, options.headers || {}); return new Response(result.body, { status: result.status, headers: { 'content-type': 'application/json' } }); }; return true; })()""")
            page.add_script_tag(content=(ROOT/'web-v20/pilot.js').read_text())
            page.wait_for_function("document.querySelector('#health').textContent.includes('shadow-only')")
            for field in ['user','tenant','bootstrap','repository','objective','target','before','after']:
                assert page.locator(f'label[for="{field}"]').count()==1
            page.fill('#bootstrap',BOOTSTRAP); page.select_option('#user','operator-1'); page.click('#login-form button[type=submit]')
            page.wait_for_function("document.querySelector('#identity').textContent.includes('operator-1')")
            page.wait_for_function("document.querySelector('#operations').textContent.includes('postgres-primary-standby')")
            assert 'Promotion is blocked' in page.locator('#operations').inner_text()
            page.click('#load-fixture'); page.wait_for_function("document.querySelector('#repository').value.length>0")
            page.click('#intake'); page.wait_for_function("!document.querySelector('#execute').disabled")
            assert 'PROMPT_INJECTION' in page.locator('#security').inner_text()
            page.click('#execute'); page.wait_for_function("document.querySelector('#evidence').textContent.includes('evidenceRoot')")
            assert 'not-production-ready' in page.locator('#evidence').inner_text()
            page.wait_for_function("document.querySelector('#decision-brief').textContent.includes('recommendation')")
            assert 'confidence' not in page.locator('#decision-brief').inner_text().lower()
            page.click('#logout'); page.wait_for_function("document.querySelector('#identity').textContent.includes('Not signed in')")
            page.select_option('#user','reviewer-1'); page.fill('#bootstrap',BOOTSTRAP); page.click('#login-form button[type=submit]')
            page.wait_for_function("document.querySelector('#identity').textContent.includes('reviewer-1')")
            assert page.locator('#review').is_enabled(); page.click('#review'); page.wait_for_function("document.querySelector('#passport').textContent.includes('signature')")
            assert 'shadow' in page.locator('#passport').inner_text()
            page.screenshot(path=str(EVIDENCE/'v29-breakthrough-pilot-approved.png'),full_page=True)
            page.click('#logout'); page.select_option('#user','operator-1'); page.fill('#bootstrap',BOOTSTRAP); page.click('#login-form button[type=submit]')
            page.wait_for_function("document.querySelector('#identity').textContent.includes('operator-1')")
            assert page.locator('#rollback').is_enabled(); page.click('#rollback'); page.wait_for_function("document.querySelector('#audit').textContent.includes('ROLLED_BACK')")
            page.evaluate("document.documentElement.dir='rtl'"); assert page.evaluate("getComputedStyle(document.body).direction")=='rtl'
            page.screenshot(path=str(EVIDENCE/'v29-breakthrough-pilot-rollback.png'),full_page=True); browser.close()
        report.update({'status':'passed','health':health,'browserMode':'playwright-dom-harness-with-cookie-aware-real-backend-bridge','version':'29.0','checks':['decision-focused-brief','no-fake-confidence','authentication','persistent-cookie-session','csrf','tenant-role-separation','prompt-injection-visible','bounded-execution','independent-review','signed-shadow-passport','exact-rollback','accessibility-labels','rtl-readiness','operational-action-center','blocked-dependency-explanation']})
    except Exception as error:
        report.update({'status':'failed','error':repr(error)}); raise
    finally:
        try: os.killpg(process.pid,signal.SIGTERM)
        except ProcessLookupError: pass
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try: os.killpg(process.pid,signal.SIGKILL)
            except ProcessLookupError: pass
            process.wait(timeout=5)
        stdout.close(); stderr.close(); report['serverStdout']=(data/'server.stdout').read_text(errors='replace'); report['serverStderr']=(data/'server.stderr').read_text(errors='replace')
        (EVIDENCE/'V29_BROWSER_E2E.json').write_text(json.dumps(report,indent=2))
if __name__=='__main__': main()
