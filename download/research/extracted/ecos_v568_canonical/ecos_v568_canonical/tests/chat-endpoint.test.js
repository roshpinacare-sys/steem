import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');
const os = require('os');
const path = require('path');
const offlineInference = require('../lib/offlineInference');

const approvalsLogPath = path.join(os.tmpdir(), `ecos-chat-endpoint-${process.pid}.ndjson`);
process.env.ECOS_APPROVALS_LOG = approvalsLogPath;

let serverModule;
let listener;
let baseUrl;
let capturedPrompt = '';

function postChat(body) {
  return fetch(`${baseUrl}/api/v1/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('V38 /api/v1/chat real endpoint behavior', () => {
  beforeAll(async () => {
    offlineInference.executeTask = async (_systemPrompt, userPrompt) => {
      capturedPrompt = userPrompt;
      return {
        aiOutput: { result: 'test response' },
        confidence: 0.5,
      };
    };

    serverModule = require('../ecos-api-server.js');
    listener = serverModule.startServer(0);
    await new Promise(resolve => listener.once('listening', resolve));
    const address = listener.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(() => {
    capturedPrompt = '';
    offlineInference.executeTask = async (_systemPrompt, userPrompt) => {
      capturedPrompt = userPrompt;
      return {
        aiOutput: { result: 'test response' },
        confidence: 0.5,
      };
    };
  });

  afterAll(async () => {
    if (listener?.listening) {
      await new Promise(resolve => listener.close(resolve));
    }
    fs.rmSync(approvalsLogPath, { force: true });
    delete process.env.ECOS_APPROVALS_LOG;
  });

  it('returns an aiResponse string for a valid chat request', async () => {
    const res = await postChat({
      text: 'Summarize this mission',
      clientAccountId: 'client::test_chat_valid',
      priceUsd: '1.00',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveProperty('aiResponse', 'test response');
    expect(body).toHaveProperty('approvalId');
    expect(body).toHaveProperty('missionId');
    expect(typeof body.aiResponse).toBe('string');
  });

  it('rejects a chat request with missing text', async () => {
    const res = await postChat({
      clientAccountId: 'client::test_chat_missing_text',
      priceUsd: '1.00',
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/text is required/i);
  });

  it('rejects a chat request with missing clientAccountId', async () => {
    const res = await postChat({
      text: 'hello',
      priceUsd: '1.00',
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/clientAccountId is required/i);
  });

  it('promotes HARD_REJECT gate output to HITL_QUEUE for chat responses', async () => {
    offlineInference.executeTask = async (_systemPrompt, userPrompt) => {
      capturedPrompt = userPrompt;
      return {
        aiOutput: { result: 'low confidence answer' },
        confidence: null,
      };
    };

    const res = await postChat({
      text: 'Handle a low-confidence question',
      clientAccountId: 'client::test_chat_hard_reject_promotion',
      priceUsd: '1.00',
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.verdict).toBe('HITL_QUEUE');
    expect(body.aiResponse).toBe('low confidence answer');
  });

  it('passes only the last 5 history messages into the inference prompt', async () => {
    const history = [
      { role: 'user', text: '1' },
      { role: 'assistant', text: '2' },
      { role: 'user', text: '3' },
      { role: 'assistant', text: '4' },
      { role: 'user', text: '5' },
      { role: 'assistant', text: '6' },
    ];

    const res = await postChat({
      text: 'Continue',
      clientAccountId: 'client::test_chat_history_slice',
      priceUsd: '1.00',
      context: { history },
    });
    await res.json();

    expect(res.status).toBe(200);
    expect(capturedPrompt).not.toContain('User: 1');
    expect(capturedPrompt).toContain('Assistant: 2');
    expect(capturedPrompt).toContain('User: 3');
    expect(capturedPrompt).toContain('Assistant: 6');
    expect(capturedPrompt.trim().endsWith('Continue')).toBe(true);
  });
});
