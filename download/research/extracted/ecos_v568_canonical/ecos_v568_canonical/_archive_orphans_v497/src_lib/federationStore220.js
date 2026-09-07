// ============================================================
// src/lib/federationStore220.js — Shared Federation Store
// Introduced V223 / P110-D. Single source of truth for the
// `_federation220` map previously defined inline in the V220 patch.
// Identifier suffix preserved (_220) for back-compat with V220–V222.
// No npm deps. Pure in-memory. Sacred files untouched.
// ============================================================
'use strict';

const FEDERATION_MAX_220 = 1000;

const _federation220 = new Map();

function _federationKey220(sourceId, targetId) {
  return `${sourceId}:${targetId}`;
}

function _federationEvict220() {
  // FIFO eviction once over cap. Map iteration order = insertion order.
  while (_federation220.size > FEDERATION_MAX_220) {
    const firstKey = _federation220.keys().next().value;
    if (firstKey === undefined) break;
    _federation220.delete(firstKey);
  }
}

function _federationReset220() {
  _federation220.clear();
}

module.exports = {
  FEDERATION_MAX_220,
  _federation220,
  _federationKey220,
  _federationEvict220,
  _federationReset220,
};
