'use strict';
/**
 * Notification service tests — V101
 * [V101] Added delivery log tests (BUG-G / P1)
 */

import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { NotificationService } from '../lib/notificationService.js';

describe('NotificationService', () => {
  it('registerWebhook stores the URL', () => {
    const ns = new NotificationService();
    ns.registerWebhook('client::test', 'http://localhost:9999/hook');
    expect(ns.getWebhooks().get('client::test')).toBe('http://localhost:9999/hook');
  });

  it('notify fires POST to webhook URL', async () => {
    const ns = new NotificationService();

    let received = [];
    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => {
        try { received.push(JSON.parse(data)); } catch (_) { received.push(data); }
        res.writeHead(200);
        res.end();
      });
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
      ns.registerWebhook('client::test', `http://127.0.0.1:${port}/hook`);
      await ns.notify('client::test', 'test.event', { foo: 'bar' });

      await new Promise(r => setTimeout(r, 200));

      expect(received.length).toBe(1);
      expect(received[0].eventType).toBe('test.event');
      expect(received[0].payload).toEqual({ foo: 'bar' });
      expect(received[0].ecosVersion).toBe('V101');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('notify does not throw on unreachable URL', async () => {
    const ns = new NotificationService();
    ns.registerWebhook('client::unreachable', 'http://127.0.0.1:1/hook');
    await expect(ns.notify('client::unreachable', 'test.event', {})).resolves.not.toThrow();
  });

  // [V101-P1] Delivery log tests
  it('[V101] getDeliveryLog returns empty array before any notifications', () => {
    const ns = new NotificationService();
    expect(ns.getDeliveryLog()).toEqual([]);
  });

  it('[V101] getDeliveryLog records successful delivery', async () => {
    const ns = new NotificationService();

    const server = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200); res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
      ns.registerWebhook('acc1', `http://127.0.0.1:${port}/hook`);
      await ns.notify('acc1', 'task.settled', { amount: 100 });
      await new Promise(r => setTimeout(r, 100));

      const log = ns.getDeliveryLog();
      expect(log.length).toBe(1);
      expect(log[0].status).toBe('ok');
      expect(log[0].accountId).toBe('acc1');
      expect(log[0].eventType).toBe('task.settled');
      expect(log[0].attempt).toBe(1);
      expect(typeof log[0].durationMs).toBe('number');
      expect(log[0].ts).toBeTruthy();
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('[V101] getDeliveryLog records failed delivery with error field', async () => {
    const ns = new NotificationService();
    ns.registerWebhook('acc2', 'http://127.0.0.1:1/hook');
    await ns.notify('acc2', 'task.settled', {});

    const log = ns.getDeliveryLog();
    expect(log.length).toBe(1);
    expect(log[0].status).toBe('error');
    expect(log[0].attempt).toBe(2); // retried once
    expect(typeof log[0].error).toBe('string');
  });

  it('[V101] getDeliveryLog respects limit parameter', async () => {
    const ns = new NotificationService();
    const server = http.createServer((req, res) => { req.resume(); res.writeHead(200); res.end(); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
      ns.registerWebhook('acc3', `http://127.0.0.1:${port}/hook`);
      await ns.notify('acc3', 'e1', {});
      await ns.notify('acc3', 'e2', {});
      await ns.notify('acc3', 'e3', {});
      await new Promise(r => setTimeout(r, 100));

      const log = ns.getDeliveryLog(2);
      expect(log.length).toBe(2);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('[V101] delivery log is capped at 200 entries', async () => {
    const ns = new NotificationService();
    // Simulate 210 failed deliveries directly via _logDelivery
    for (let i = 0; i < 210; i++) {
      ns._logDelivery({ ts: new Date().toISOString(), accountId: 'x', eventType: 'e', url: 'http://x', status: 'ok', attempt: 1, durationMs: 1 });
    }
    expect(ns.getDeliveryLog().length).toBe(200);
  });
});
