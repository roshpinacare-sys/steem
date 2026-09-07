const $ = (id) => document.getElementById(id);
let fixture;
let session;

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function announce(message) { $('announcer').textContent = message; }
function setTimeline(index, status = 'active') { [...$('timeline').children].forEach((item, i) => item.dataset.state = i < index ? 'done' : i === index ? status : 'waiting'); }
function renderJson(id, value) { $(id).textContent = JSON.stringify(value, null, 2); }
function findingHtml(finding) { return `<div class="finding ${finding.severity === 'critical' ? 'critical' : ''}"><span class="badge">${escapeHtml(finding.kind)}</span> <strong>${escapeHtml(finding.file)}</strong><br>${escapeHtml(finding.summary)} <small>(${escapeHtml(finding.ruleId)})</small></div>`; }
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = String(value); return div.innerHTML; }

async function loadHealth() {
  const health = await api('/api/health');
  $('health').textContent = `Status: ${health.status}\nPromotion: ${health.promotionBoundary}\nPostgreSQL: ${health.infrastructure.postgres}\nKMS/HSM: ${health.infrastructure.kmsHsm}`;
}

$('load-demo').addEventListener('click', async () => {
  fixture = await api('/api/demo-fixture');
  $('repository').value = fixture.repositoryPath;
  $('objective').value = fixture.objective;
  $('target-file').value = fixture.targetFile;
  $('test-command').value = fixture.testCommand.join(' ');
  $('before').value = fixture.exactBefore;
  $('after').value = fixture.exactAfter;
  announce('Safe demonstration loaded.');
});

$('commitment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    setTimeline(0, 'active');
    const testCommand = $('test-command').value.trim().split(/\s+/);
    session = await api('/api/sessions/intake', { method: 'POST', body: JSON.stringify({
      sourceRepository: $('repository').value.trim(), objective: $('objective').value.trim(), targetFile: $('target-file').value.trim(),
      allowedFiles: [$('target-file').value.trim()], exactBefore: $('before').value, exactAfter: $('after').value, testCommand,
    }) });
    setTimeline(1, 'active');
    $('permissions').innerHTML = `<p><strong>Requested:</strong> read repository, write <code>${escapeHtml($('target-file').value)}</code>, run explicit test command.</p><p><strong>Denied:</strong> network, secrets, external Git mutation, production promotion.</p>`;
    $('security').innerHTML = session.findings.length ? session.findings.map(findingHtml).join('') : '<p class="good">No bounded scan findings.</p>';
    $('execute').disabled = false;
    announce('Repository intake complete. Review permissions and security findings.');
  } catch (error) { fail(error); }
});

$('execute').addEventListener('click', async () => {
  try {
    setTimeline(2, 'active');
    session = await api(`/api/sessions/${session.sessionId}/execute`, { method: 'POST', body: '{}' });
    setTimeline(4, 'active');
    $('tests').innerHTML = `<p class="good"><strong>Tests passed.</strong></p><p>Exit code: ${session.testExecution.exitCode}; duration: ${session.testExecution.durationMs} ms</p><p>Evidence root: <code>${escapeHtml(session.evidenceRoot)}</code></p>`;
    $('claims').innerHTML = `<ul>${session.unsupportedClaims.map((claim) => `<li>${escapeHtml(claim)}</li>`).join('')}</ul>`;
    const state = await api(`/api/sessions/${session.sessionId}`);
    renderJson('change', { changedFiles: state.changedFiles, status: state.status, evidenceRoot: state.evidenceRoot });
    $('review').disabled = false;
    $('rollback').disabled = false;
    announce('Bounded change and tests completed. Independent review is required.');
  } catch (error) { fail(error); }
});

$('review').addEventListener('click', async () => {
  try {
    session = await api(`/api/sessions/${session.sessionId}/review`, { method: 'POST', body: JSON.stringify({ reviewerId: 'independent-reviewer-1' }) });
    setTimeline(5, 'done');
    renderJson('passport', session.passport);
    $('audit').innerHTML = `<p class="good"><strong>Shadow Action Passport issued.</strong></p><p>Reviewer: ${escapeHtml(session.reviewerId)}</p><p>External mutation remains disabled.</p>`;
    $('review').disabled = true;
    announce('Independent review completed and a shadow-only passport was issued.');
  } catch (error) { fail(error); }
});

$('rollback').addEventListener('click', async () => {
  try {
    session = await api(`/api/sessions/${session.sessionId}/rollback`, { method: 'POST', body: '{}' });
    setTimeline(2, 'done');
    $('audit').innerHTML = '<p class="good"><strong>Rollback applied.</strong> The workspace matches its exact base commit.</p>';
    $('rollback').disabled = true;
    $('review').disabled = true;
    announce('Rollback applied and the exact base tree was restored.');
  } catch (error) { fail(error); }
});

function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  [...$('timeline').children].find((item) => item.dataset.state === 'active')?.setAttribute('data-state', 'failed');
  $('audit').innerHTML = `<p class="bad"><strong>Blocked:</strong> ${escapeHtml(message)}</p>`;
  announce(`Workflow blocked: ${message}`);
}

loadHealth().catch(fail);
