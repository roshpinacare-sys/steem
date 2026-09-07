/**
 * src/lib/ragDocManager244.js — ECOS RAG Document Manager (P140)
 * ────────────────────────────────────────────────────────────────
 * Manages the corpus of ingested RAG documents via vectorMemory242.
 *
 *   listDocuments244(opts)        — list ingested docs (distinct docIds + meta)
 *   deleteDocument244(docId)      — delete all chunks for a docId
 *   getDocumentInfo244(docId)     — chunk count + meta for a specific doc
 *
 * All operations work through the shared defaultRagPipeline243 instance
 * (or an injected override) which owns the defaultVectorMemory242 store.
 *
 * Zero new npm deps. Identifiers end with 244.
 * R1: sacred files untouched. R2: identifiers _244. R3: zero npm deps.
 * Mirror rule: this file is mirrored to lib/ragDocManager244.js.
 */

'use strict';

// ── Soft-require collaborators ────────────────────────────────────────────────
function _req244d(p) { try { return require(p); } catch (_) { return null; } }

const _rag243Mod = _req244d('./ragPipeline243');
const _vm242Mod  = _req244d('./vectorMemory242');
const _auditLog  = _req244d('./auditLog');

// ── Constants ─────────────────────────────────────────────────────────────────
const DOC_MANAGER_VERSION_244    = 'V244';
const DOC_MANAGER_MAX_LIST_244   = 500;  // max docs returned in list
const RAG_META_TYPE_244          = 'rag_chunk'; // matches RAG_META_PREFIX_243

// ── Stats ─────────────────────────────────────────────────────────────────────
const _docMgrStats244 = {
  listCalls:   0,
  deleteCalls: 0,
  infoCalls:   0,
  docsDeleted: 0,
  chunksDeleted: 0,
};

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Resolve the vector memory instance from a ragPipeline or directly.
 * @param {object} [ragPipeline]
 * @returns {object|null}
 */
function _resolveVecMem244(ragPipeline) {
  // Prefer the pipeline's internal _mem243 if accessible
  const pipeline = ragPipeline
    || (_rag243Mod && _rag243Mod.defaultRagPipeline243);
  if (pipeline && pipeline._mem243) return pipeline._mem243;
  // Fall back to defaultVectorMemory242
  return _vm242Mod ? _vm242Mod.defaultVectorMemory242 : null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * List all ingested documents (distinct docId values).
 * Returns one summary entry per docId, with chunk count and the metadata
 * of the first chunk as a sample.
 *
 * @param {object}  [opts]
 * @param {number}  [opts.limit]        max docs to return (default 50, max 500)
 * @param {object}  [opts.ragPipeline]  override pipeline instance
 * @returns {{ ok: boolean, documents: Array, total: number }}
 */
function listDocuments244(opts) {
  const o = opts || {};
  _docMgrStats244.listCalls++;
  const limit = Math.max(1, Math.min(o.limit || 50, DOC_MANAGER_MAX_LIST_244));

  const vecMem = _resolveVecMem244(o.ragPipeline);
  if (!vecMem) {
    return { ok: false, error: 'DOC_MGR_244: vectorMemory242 not available', ecosVersion: DOC_MANAGER_VERSION_244 };
  }

  // Get all keys that belong to RAG chunks
  let allKeys;
  try {
    allKeys = vecMem.listKeys242({ type: RAG_META_TYPE_244 }, 50_000);
  } catch (_) {
    // Fallback: iterate the store if listKeys242 not available
    allKeys = [];
  }

  // Group by docId
  const docMap = new Map(); // docId → { chunkCount, sampleMeta }
  for (const key of allKeys) {
    let entry;
    try {
      entry = vecMem.getMemory242 ? vecMem.getMemory242(key) : null;
    } catch (_) { entry = null; }
    if (!entry) continue;

    const docId = entry.meta && entry.meta.docId;
    if (!docId) continue;

    if (!docMap.has(docId)) {
      docMap.set(docId, { docId, chunkCount: 0, sampleMeta: { ...entry.meta } });
    }
    docMap.get(docId).chunkCount++;
  }

  const documents = [...docMap.values()]
    .sort((a, b) => String(a.docId).localeCompare(String(b.docId)))
    .slice(0, limit)
    .map(({ docId, chunkCount, sampleMeta }) => {
      // Strip per-chunk fields from sample meta
      const { chunkIndex: _ci, chunkText: _ct, ...cleanMeta } = sampleMeta;
      return { docId, chunkCount, meta: cleanMeta };
    });

  return {
    ok: true,
    documents,
    total: docMap.size,
    returned: documents.length,
    ecosVersion: DOC_MANAGER_VERSION_244,
  };
}

/**
 * Delete all vector-memory entries (chunks) belonging to a docId.
 *
 * @param {string} docId
 * @param {object} [opts]
 * @param {object} [opts.ragPipeline] override pipeline instance
 * @returns {{ ok: boolean, docId: string, chunksDeleted: number }}
 */
function deleteDocument244(docId, opts) {
  const o = opts || {};
  _docMgrStats244.deleteCalls++;

  const id = String(docId || '').trim();
  if (!id) {
    return { ok: false, error: 'DOC_MGR_244: docId required', code: 'DOC_MGR_MISSING_DOCID_244', ecosVersion: DOC_MANAGER_VERSION_244 };
  }

  const vecMem = _resolveVecMem244(o.ragPipeline);
  if (!vecMem) {
    return { ok: false, error: 'DOC_MGR_244: vectorMemory242 not available', code: 'DOC_MGR_DEP_MISSING_244', ecosVersion: DOC_MANAGER_VERSION_244 };
  }

  let chunksDeleted = 0;
  try {
    chunksDeleted = vecMem.deleteByMeta242({ docId: id });
  } catch (e) {
    return { ok: false, error: e.message, code: 'DOC_MGR_DELETE_ERROR_244', ecosVersion: DOC_MANAGER_VERSION_244 };
  }

  _docMgrStats244.docsDeleted++;
  _docMgrStats244.chunksDeleted += chunksDeleted;

  // Emit audit event
  if (_auditLog) {
    try {
      const al = _auditLog.defaultAuditLog;
      if (al && typeof al.append === 'function') {
        al.append('RAG_DOC_DELETE_244', { docId: id, chunksDeleted });
      }
    } catch (_) {}
  }

  return {
    ok: true,
    docId: id,
    chunksDeleted,
    ecosVersion: DOC_MANAGER_VERSION_244,
  };
}

/**
 * Get info (chunk count + sample metadata) for a specific docId.
 *
 * @param {string} docId
 * @param {object} [opts]
 * @param {object} [opts.ragPipeline] override pipeline instance
 * @returns {{ ok: boolean, docId: string, chunkCount: number, meta: object }}
 */
function getDocumentInfo244(docId, opts) {
  const o = opts || {};
  _docMgrStats244.infoCalls++;

  const id = String(docId || '').trim();
  if (!id) {
    return { ok: false, error: 'DOC_MGR_244: docId required', code: 'DOC_MGR_MISSING_DOCID_244', ecosVersion: DOC_MANAGER_VERSION_244 };
  }

  const vecMem = _resolveVecMem244(o.ragPipeline);
  if (!vecMem) {
    return { ok: false, error: 'DOC_MGR_244: vectorMemory242 not available', code: 'DOC_MGR_DEP_MISSING_244', ecosVersion: DOC_MANAGER_VERSION_244 };
  }

  let allKeys;
  try {
    allKeys = vecMem.listKeys242({ type: RAG_META_TYPE_244, docId: id }, 50_000);
  } catch (_) {
    allKeys = [];
  }

  const chunkCount = allKeys.length;
  let sampleMeta = {};
  if (chunkCount > 0) {
    try {
      const first = vecMem.getMemory242 ? vecMem.getMemory242(allKeys[0]) : null;
      if (first && first.meta) {
        const { chunkIndex: _ci, chunkText: _ct, ...clean } = first.meta;
        sampleMeta = clean;
      }
    } catch (_) {}
  }

  if (chunkCount === 0) {
    return {
      ok: false,
      error: `DOC_MGR_244: docId "${id}" not found`,
      code: 'DOC_MGR_NOT_FOUND_244',
      ecosVersion: DOC_MANAGER_VERSION_244,
    };
  }

  return {
    ok: true,
    docId: id,
    chunkCount,
    meta: sampleMeta,
    ecosVersion: DOC_MANAGER_VERSION_244,
  };
}

/**
 * Return document manager statistics.
 */
function getDocMgrStats244() {
  return { ..._docMgrStats244, version: DOC_MANAGER_VERSION_244 };
}

module.exports = {
  listDocuments244,
  deleteDocument244,
  getDocumentInfo244,
  getDocMgrStats244,
  DOC_MANAGER_VERSION_244,
  DOC_MANAGER_MAX_LIST_244,
  // expose for testing
  _docMgrStats244,
};
