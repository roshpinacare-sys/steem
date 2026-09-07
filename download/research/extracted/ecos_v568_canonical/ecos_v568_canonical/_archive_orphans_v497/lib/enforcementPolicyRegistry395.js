'use strict';
/**
 * enforcementPolicyRegistry395.js — ECOS V395 D2
 *
 * Register named policies so multiple routes can share a single named policy
 * rather than configuring opts individually.
 *
 * Function: createEnforcementPolicyRegistry395({ audit, defaultBypassDays, defaultAlertThresholdDays })
 * Methods:  registerPolicy395(name, policy)
 *           getPolicy395(name)
 *           listPolicies395()
 *           deletePolicy395(name)
 */

'use strict';

const ENFORCEMENT_POLICY_REGISTRY_VERSION_395 = '395.0.0';

const EVT_POLICY_REGISTER_395 = 'enforcement_policy_register_event_type_395';
const EVT_POLICY_DELETE_395   = 'enforcement_policy_delete_event_type_395';
const EVT_POLICY_GET_395      = 'enforcement_policy_get_event_type_395';

const VALID_ACTIONS = new Set(['transfer', 'reward']);

function createEnforcementPolicyRegistry395(opts = {}) {
  const audit                  = opts.audit || opts.auditLog || null;
  const defaultBypassDays      = typeof opts.defaultBypassDays === 'number'      ? opts.defaultBypassDays      : 30;
  const defaultAlertThreshold  = typeof opts.defaultAlertThresholdDays === 'number' ? opts.defaultAlertThresholdDays : 3;
  const maxPolicies            = typeof opts.maxPolicies === 'number' ? opts.maxPolicies : 1000;

  // name → policy object
  const _policies395 = new Map();

  function _appendAudit(entry) {
    if (!audit) return;
    if (typeof audit.append === 'function') audit.append(entry);
  }

  /**
   * registerPolicy395(name, policy)
   *
   * policy: {
   *   action              : 'transfer' | 'reward'   (required)
   *   bypassDays?         : number                   (default: defaultBypassDays)
   *   alertThresholdDays? : number                   (default: defaultAlertThreshold)
   *   description?        : string
   *   metadata?           : object
   * }
   *
   * Returns the stored policy.
   * Throws if name is not a non-empty string, action is invalid, or registry is full.
   */
  function registerPolicy395(name, policy) {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new Error('POLICY_NAME_REQUIRED: name must be a non-empty string');
    }
    if (!policy || typeof policy !== 'object') {
      throw new Error('POLICY_OBJECT_REQUIRED: policy must be an object');
    }
    if (!VALID_ACTIONS.has(policy.action)) {
      throw new Error(`POLICY_INVALID_ACTION: action must be one of [${[...VALID_ACTIONS].join(', ')}]`);
    }
    if (_policies395.size >= maxPolicies && !_policies395.has(name)) {
      throw new Error(`POLICY_REGISTRY_FULL: max ${maxPolicies} policies`);
    }

    const now = Date.now();
    const stored = {
      name,
      action:             policy.action,
      bypassDays:         typeof policy.bypassDays === 'number'         ? policy.bypassDays         : defaultBypassDays,
      alertThresholdDays: typeof policy.alertThresholdDays === 'number' ? policy.alertThresholdDays : defaultAlertThreshold,
      description:        typeof policy.description === 'string'        ? policy.description        : '',
      metadata:           policy.metadata && typeof policy.metadata === 'object' ? Object.assign({}, policy.metadata) : {},
      registeredAt:       now,
      updatedAt:          now,
      version:            ENFORCEMENT_POLICY_REGISTRY_VERSION_395,
    };

    // If updating, preserve original registeredAt
    if (_policies395.has(name)) {
      stored.registeredAt = _policies395.get(name).registeredAt;
    }

    _policies395.set(name, stored);

    _appendAudit({
      type: EVT_POLICY_REGISTER_395,
      ts:   now,
      data: { name, action: stored.action, bypassDays: stored.bypassDays },
    });

    return Object.assign({}, stored);
  }

  /**
   * getPolicy395(name)
   *
   * Returns the policy object for the given name.
   * Throws { code: 'POLICY_NOT_FOUND' } if not registered.
   */
  function getPolicy395(name) {
    const policy = _policies395.get(name);
    if (!policy) {
      const err = new Error(`POLICY_NOT_FOUND: no policy registered under name "${name}"`);
      err.code = 'POLICY_NOT_FOUND';
      throw err;
    }
    _appendAudit({
      type: EVT_POLICY_GET_395,
      ts:   Date.now(),
      data: { name },
    });
    return Object.assign({}, policy);
  }

  /**
   * listPolicies395(opts?)
   *   opts.action   — filter by action
   *   opts.limit    — max results (default: all)
   *   opts.offset   — skip N results
   *
   * Returns { total, policies[] }
   */
  function listPolicies395(opts = {}) {
    let all = [..._policies395.values()];

    if (opts.action) {
      all = all.filter(p => p.action === opts.action);
    }

    const total  = all.length;
    const offset = typeof opts.offset === 'number' ? opts.offset : 0;
    const limit  = typeof opts.limit  === 'number' ? opts.limit  : all.length;

    return {
      total,
      policies: all.slice(offset, offset + limit).map(p => Object.assign({}, p)),
    };
  }

  /**
   * deletePolicy395(name)
   *
   * Removes a registered policy.
   * Throws { code: 'POLICY_NOT_FOUND' } if not registered.
   */
  function deletePolicy395(name) {
    if (!_policies395.has(name)) {
      const err = new Error(`POLICY_NOT_FOUND: no policy registered under name "${name}"`);
      err.code = 'POLICY_NOT_FOUND';
      throw err;
    }
    _policies395.delete(name);
    _appendAudit({
      type: EVT_POLICY_DELETE_395,
      ts:   Date.now(),
      data: { name },
    });
    return { deleted: true, name };
  }

  /**
   * hasPolicy395(name) — boolean check without audit event
   */
  function hasPolicy395(name) {
    return _policies395.has(name);
  }

  return {
    registerPolicy395,
    getPolicy395,
    listPolicies395,
    deletePolicy395,
    hasPolicy395,
    ENFORCEMENT_POLICY_REGISTRY_VERSION_395,
  };
}

module.exports = {
  createEnforcementPolicyRegistry395,
  ENFORCEMENT_POLICY_REGISTRY_VERSION_395,
  EVT_POLICY_REGISTER_395,
  EVT_POLICY_DELETE_395,
  EVT_POLICY_GET_395,
};
