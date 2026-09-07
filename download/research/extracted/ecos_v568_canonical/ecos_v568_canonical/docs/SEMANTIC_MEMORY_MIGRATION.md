# ECOS Semantic Memory Migration — V106

## Problem Statement

`lib/memorySubstrate.js` used `heuristicEmbed()` — a SHA-256-derived 64-dim vector — 
as the default embedding when no real provider was configured.

**This is not semantic similarity.** Two sentences with identical meaning but different
words produce ~0 cosine similarity under heuristicEmbed. Memory retrieval was 
non-functional for semantic use cases.

---

## Solution — V106

### New module: `lib/embeddingProvider.js`

Implements an `EmbeddingProvider` abstraction with:

| Provider | Dimensions | isReal | When Active |
|---|---|---|---|
| `OllamaEmbeddingProvider` | 768 (nomic-embed-text) | ✅ | `LOCAL_LLM_URL` set |
| `OpenAIEmbeddingProvider` | 1536 (text-embedding-3-small) | ✅ | `OPENAI_API_KEY` set |
| `HeuristicEmbeddingProvider` | 64 (SHA-256) | ❌ | Fallback only |
| `EmbeddingProviderWithCache` | Wraps any provider | — | Default wrapper |
| `FallbackEmbeddingProvider` | Tries chain, falls to heuristic | — | Auto-detection |

### Provider Resolution Order

```
EMBEDDING_PROVIDER env var
  'ollama'        → OllamaEmbeddingProvider
  'openai'        → OpenAIEmbeddingProvider
  'openai-compat' → OpenAIEmbeddingProvider (custom OPENAI_BASE_URL)
  'heuristic'     → HeuristicEmbeddingProvider (disable semantic, for testing)
  (not set)       → FallbackEmbeddingProvider:
                      1. Ollama (if LOCAL_LLM_URL)
                      2. OpenAI (if OPENAI_API_KEY)
                      3. Heuristic (fallback — logs WARNING)
```

### Caching

`EmbeddingProviderWithCache` wraps any provider with an LRU in-memory cache:
- Default size: 2000 entries
- LRU eviction: oldest unused entry removed when full
- Cache cleared on `clearCache()`
- Stats via `cacheStats()`: `{ size, maxSize }`

Avoids repeated API calls for the same text (common in retrieval pipelines).

---

## Integration with MemorySubstrate

`lib/memorySubstrate.js` already supports `opts.embedFn` injection. V106 wires this:

```js
const { defaultEmbeddingProvider } = require('./embeddingProvider');
const memory = new MemorySubstrate({
  embedFn: text => defaultEmbeddingProvider.embed(text),
});
```

**In ecos-api-server.js** (V106 wiring):
```js
const { defaultEmbeddingProvider } = require('./lib/embeddingProvider');
defaultMemory.setEmbedFn(text => defaultEmbeddingProvider.embed(text));
```

### embeddingType tagging

All `retrieve()` results now include `embeddingType` field:
- `'heuristic'` — SHA-256 based, NOT semantically meaningful
- `'ollama:nomic-embed-text'` — real semantic embedding
- `'openai:text-embedding-3-small'` — real semantic embedding

---

## Re-embedding Migration

### Problem

Entries stored with `heuristicEmbed` vectors CANNOT be compared to entries
stored with real embeddings — the vector spaces are incompatible (different
dimensions, different semantic meaning).

### Migration Path

**Step 1**: Enable pgvector (requires Postgres 15+ with pgvector installed):
```sql
-- From db/migration_phase5.sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE knowledge_patches ADD COLUMN embedding_v2 vector(1536);
```

**Step 2**: Run re-embedding script (new V106):
```bash
node scripts/reembed-patches.js --provider openai --batch 50
```

The script:
1. Fetches patches where `embedding_type = 'heuristic'`
2. Calls the configured embedding provider
3. Updates `embedding_v2` + `embedding_type`
4. Logs progress to `embedding_migration_log`

**Step 3**: Switch semantic search to use `embedding_v2`:
```sql
-- Similarity search using new column
SELECT id, patch_body, embedding_v2 <=> $1 AS distance
FROM knowledge_patches
WHERE embedding_type != 'heuristic'
ORDER BY distance ASC LIMIT 10;
```

### Backward Compatibility

- `embedding` column (legacy heuristic) preserved unchanged
- `embedding_v2` column is additive (new in V106)
- `semanticSearch.js` falls back to TF-IDF if pgvector unavailable — preserved
- `memorySubstrate._embed()` still falls back to heuristic if no provider configured

---

## Warning System

When `heuristicEmbed` is active and `retrieve()` is called, a structured warning is emitted:

```
[EmbeddingProvider] WARNING: All real providers failed.
Using heuristicEmbed — semantic retrieval is NOT functional.
Configure OPENAI_API_KEY or LOCAL_LLM_URL to enable real embeddings.
```

Results tagged with `embeddingType: 'heuristic'` so callers can surface this to users.

---

## Configuration Reference

```env
# Explicit provider selection
EMBEDDING_PROVIDER=openai          # 'openai' | 'ollama' | 'openai-compat' | 'heuristic'

# OpenAI embeddings
OPENAI_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small  # default for OpenAI

# Ollama embeddings  
LOCAL_LLM_URL=http://localhost:11434
EMBEDDING_MODEL=nomic-embed-text        # default for Ollama

# OpenAI-compatible (vLLM, LM Studio, etc.)
EMBEDDING_PROVIDER=openai-compat
OPENAI_BASE_URL=http://localhost:8080
OPENAI_API_KEY=none
EMBEDDING_MODEL=your-model-name
```

---

*ECOS Semantic Memory Migration · V106 · 2026-05-28*
