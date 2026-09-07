'use strict';
/**
 * Tests for lib/embeddingProvider.js — V106
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const {
  HeuristicEmbeddingProvider,
  OllamaEmbeddingProvider,
  OpenAIEmbeddingProvider,
  EmbeddingProviderWithCache,
  FallbackEmbeddingProvider,
  heuristicEmbed,
} = await import('../lib/embeddingProvider.js');

describe('heuristicEmbed', () => {
  it('returns a 64-dim normalized vector', () => {
    const v = heuristicEmbed('hello world');
    expect(v).toHaveLength(64);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 4);
  });

  it('is deterministic for the same input', () => {
    expect(heuristicEmbed('test')).toEqual(heuristicEmbed('test'));
  });

  it('produces different vectors for different inputs', () => {
    const a = heuristicEmbed('apple');
    const b = heuristicEmbed('orange');
    expect(a).not.toEqual(b);
  });

  it('handles empty string', () => {
    const v = heuristicEmbed('');
    expect(v).toHaveLength(64);
  });
});

describe('HeuristicEmbeddingProvider', () => {
  it('has correct metadata', () => {
    const p = new HeuristicEmbeddingProvider();
    expect(p.providerId).toBe('heuristic');
    expect(p.dimensions).toBe(64);
    expect(p.isReal).toBe(false);
  });

  it('embed() returns 64-dim vector', async () => {
    const p = new HeuristicEmbeddingProvider();
    const v = await p.embed('semantic test');
    expect(v).toHaveLength(64);
  });
});

describe('OllamaEmbeddingProvider', () => {
  it('has correct metadata', () => {
    const p = new OllamaEmbeddingProvider({ baseUrl: 'http://localhost:11434' });
    expect(p.providerId).toContain('ollama');
    expect(p.isReal).toBe(true);
  });

  it('embed() calls Ollama API and returns vector', async () => {
    const mockVec = Array(768).fill(0).map((_, i) => i / 768);
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ embedding: mockVec }),
    });

    const p = new OllamaEmbeddingProvider({ baseUrl: 'http://localhost:11434' });
    const v = await p.embed('hello');
    expect(v).toHaveLength(768);
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it('throws on non-ok HTTP response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });
    const p = new OllamaEmbeddingProvider();
    await expect(p.embed('test')).rejects.toThrow('500');
  });
});

describe('OpenAIEmbeddingProvider', () => {
  it('has correct metadata', () => {
    const p = new OpenAIEmbeddingProvider({ apiKey: 'sk-test' });
    expect(p.providerId).toContain('openai');
    expect(p.isReal).toBe(true);
  });

  it('embed() calls OpenAI API and returns vector', async () => {
    const mockVec = Array(1536).fill(0).map((_, i) => i / 1536);
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding: mockVec }] }),
    });

    const p = new OpenAIEmbeddingProvider({ apiKey: 'sk-test' });
    const v = await p.embed('hello');
    expect(v).toHaveLength(1536);
    expect(global.fetch).toHaveBeenCalledOnce();
  });

  it('throws on non-ok HTTP response', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });
    const p = new OpenAIEmbeddingProvider({ apiKey: 'bad-key' });
    await expect(p.embed('test')).rejects.toThrow('401');
  });
});

describe('EmbeddingProviderWithCache', () => {
  it('caches repeated embed() calls', async () => {
    const inner = new HeuristicEmbeddingProvider();
    const spy   = vi.spyOn(inner, 'embed');
    const p     = new EmbeddingProviderWithCache(inner, { cacheSize: 100 });

    const v1 = await p.embed('hello');
    const v2 = await p.embed('hello');

    expect(v1).toEqual(v2);
    expect(spy).toHaveBeenCalledTimes(1);  // second call served from cache
  });

  it('evicts oldest entries when full', async () => {
    const inner = new HeuristicEmbeddingProvider();
    const p     = new EmbeddingProviderWithCache(inner, { cacheSize: 3 });

    await p.embed('a');
    await p.embed('b');
    await p.embed('c');
    expect(p.cacheStats().size).toBe(3);

    await p.embed('d');
    expect(p.cacheStats().size).toBe(3);  // evicted 'a'
  });

  it('reports cache stats', async () => {
    const p = new EmbeddingProviderWithCache(new HeuristicEmbeddingProvider());
    await p.embed('test');
    const stats = p.cacheStats();
    expect(stats).toHaveProperty('size');
    expect(stats).toHaveProperty('maxSize');
  });

  it('clearCache resets', async () => {
    const inner = new HeuristicEmbeddingProvider();
    const spy   = vi.spyOn(inner, 'embed');
    const p     = new EmbeddingProviderWithCache(inner);

    await p.embed('hello');
    p.clearCache();
    await p.embed('hello');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('FallbackEmbeddingProvider', () => {
  it('falls back to heuristic when all providers fail', async () => {
    const failing = {
      get providerId() { return 'failing'; },
      get dimensions() { return 64; },
      get isReal() { return true; },
      embed: async () => { throw new Error('provider down'); },
    };
    const heuristic = new HeuristicEmbeddingProvider();
    const p = new FallbackEmbeddingProvider([failing, heuristic]);
    const v = await p.embed('test');
    expect(v).toHaveLength(64);
    expect(p.isReal).toBe(false);  // resolved to heuristic
  });

  it('uses first working provider', async () => {
    const mockVec = Array(768).fill(0.1);
    const working = {
      get providerId() { return 'working'; },
      get dimensions() { return 768; },
      get isReal() { return true; },
      embed: async () => mockVec,
    };
    const heuristic = new HeuristicEmbeddingProvider();
    const p = new FallbackEmbeddingProvider([working, heuristic]);
    const v = await p.embed('test');
    expect(v).toEqual(mockVec);
    expect(p.isReal).toBe(true);
  });
});
