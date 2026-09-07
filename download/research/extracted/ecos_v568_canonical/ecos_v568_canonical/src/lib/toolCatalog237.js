/**
 * src/lib/toolCatalog237.js — ECOS Tool Catalog (P129)
 * ------------------------------------------------------------
 * A rich, versioned registry of available tools/capabilities.
 * Keeps track of tool schemas: { name, description, server, input_schema, cost }.
 * Provides methods to register, list, and retrieve tools.
 * Connects with agentRuntime._toolRegistry.
 * Zero new npm dependencies. Identifiers end with 237.
 */

'use strict';

class ToolCatalog237 {
  constructor() {
    this._tools = new Map(); // name -> { name, description, server, input_schema, cost, fn }
  }

  /**
   * Register a tool in the catalog.
   * If an agentRuntime is provided, it registers the runner function there as well.
   * 
   * @param {object} tool
   * @param {string} tool.name - Unique name of the tool (e.g. 'web_search')
   * @param {string} tool.description - Semantic description of what the tool does
   * @param {string} tool.server - Name of the server/connector providing this tool (e.g. 'mcp-server-web')
   * @param {object} tool.input_schema - JSON schema of the tool arguments (e.g. { type: 'object', properties: {...} })
   * @param {number|string} tool.cost - Microcents or USD representation of execution cost
   * @param {function} [fn] - The actual executable async function for the tool
   * @param {object} [runtime] - Optional agentRuntime instance to register the tool function automatically
   */
  registerTool237(tool, fn, runtime) {
    if (!tool || typeof tool.name !== 'string' || !tool.name) {
      throw new Error('ToolCatalog237: tool must have a non-empty name string');
    }
    if (typeof tool.description !== 'string') {
      throw new Error('ToolCatalog237: tool must have a description string');
    }
    if (typeof tool.server !== 'string') {
      throw new Error('ToolCatalog237: tool must have a server string');
    }
    if (!tool.input_schema || typeof tool.input_schema !== 'object') {
      throw new Error('ToolCatalog237: tool must have a valid input_schema object');
    }

    const entry = {
      name: tool.name,
      description: tool.description,
      server: tool.server,
      input_schema: tool.input_schema,
      cost: tool.cost || 0,
      fn: fn || null
    };

    this._tools.set(tool.name, entry);

    // If runner function and runtime are provided, register in agentRuntime._toolRegistry
    if (fn && runtime && typeof runtime.registerTool === 'function') {
      runtime.registerTool(tool.name, fn);
    }
  }

  /**
   * Retrieve a tool definition by name.
   * @param {string} name
   * @returns {object|null}
   */
  getTool237(name) {
    const t = this._tools.get(name);
    if (!t) return null;
    // Return a copy without the executable function
    return {
      name: t.name,
      description: t.description,
      server: t.server,
      input_schema: t.input_schema,
      cost: t.cost
    };
  }

  /**
   * List all registered tools.
   * @returns {Array<object>}
   */
  listTools237() {
    return Array.from(this._tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      server: t.server,
      input_schema: t.input_schema,
      cost: t.cost
    }));
  }

  /**
   * Get the actual runner function of a tool.
   * @param {string} name
   * @returns {function|null}
   */
  getRunner237(name) {
    const t = this._tools.get(name);
    return t ? t.fn : null;
  }

  /**
   * Clear the catalog (primarily for testing).
   */
  clear237() {
    this._tools.clear();
  }
}

const defaultCatalog237 = new ToolCatalog237();

module.exports = {
  ToolCatalog237,
  defaultCatalog237
};
