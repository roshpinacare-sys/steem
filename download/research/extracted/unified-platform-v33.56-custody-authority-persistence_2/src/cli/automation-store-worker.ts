import { readFileSync } from 'node:fs';
import { FileGovernedAutomationStore } from '../operations/governed-automation.js';
const inputPath = process.argv[2]; if (inputPath === undefined) throw new Error('automation_worker_input_required');
const input = JSON.parse(readFileSync(inputPath, 'utf8')) as { root: string; eventDigest: string; signedRun: Parameters<FileGovernedAutomationStore['putRun']>[1] };
const row = new FileGovernedAutomationStore(input.root).putRun(input.eventDigest, input.signedRun);
process.stdout.write(`${JSON.stringify({ eventId: row.signedRun.payload.eventId, digest: row.digest })}\n`);
