import { readFileSync } from 'node:fs';
const compose = readFileSync('infra/private-server/compose.yaml', 'utf8');
const containerfile = readFileSync('infra/private-server/Containerfile', 'utf8');
const requirements = readFileSync('infra/private-server/PRIVATE_SERVER_REQUIREMENTS.lock', 'utf8');
const required = [
  ['postgres pinned tag', /postgres:16\.4-bookworm/],
  ['no new privileges', /no-new-privileges:true/],
  ['drop capabilities', /cap_drop:\s*\["ALL"\]/],
  ['internal network', /internal:\s*true/],
  ['secret files', /POSTGRES_PASSWORD_FILE/],
  ['read only app', /read_only:\s*true/],
  ['process limit', /pids_limit:\s*128/],
  ['memory limit', /mem_limit:\s*512m/],
  ['health check', /healthcheck:/],
  ['non-root user', /USER 10001:10001/],
  ['node pinned', /node:22\.16\.0-bookworm-slim/],
];
const failures = required.filter(([, pattern]) => !pattern.test(compose + '\n' + containerfile)).map(([name]) => name);
if (/latest/i.test(compose + containerfile)) failures.push('floating latest tag');
if (/curl\s+[^\n]*\|\s*(?:sh|bash)/i.test(compose + containerfile)) failures.push('curl pipe shell');
if (!requirements.includes('readiness_ceiling=Integrated-Pilot')) failures.push('readiness ceiling missing');
const report = { status: failures.length === 0 ? 'passed' : 'failed', checks: required.map(([name]) => name), failures, limitations: ['container-images-not-pinned-by-digest', 'runtime-not-exercised-in-current-environment'] };
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (failures.length) process.exit(1);
