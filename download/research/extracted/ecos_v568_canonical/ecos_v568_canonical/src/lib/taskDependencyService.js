/**
 * lib/taskDependencyService.js — V160
 * ======================================
 * Workspace Task Dependency Graph
 * גרף תלויות בין workspace tasks — block/depend-on, cycle detection, topo sort
 *
 * תכונות:
 *  - קישור תלות: task A תלויה ב-task B (B חייבת להיסגר לפני A)
 *  - Cycle detection: DFS — זורק CyclicDependencyError
 *  - Topological sort לתכנון ריצה
 *  - Auto-block: task ממתין אם blocker עדיין פתוחה
 *  - Dependency tree visualization
 *  - DB integration: טבלת task_dependencies
 *
 * Sacred Files: lib/fiatLedger.js, lib/auditLog.js — UNTOUCHED
 * [V160-TASK-02]
 */

'use strict';

const crypto = require('crypto');

// ── Errors ─────────────────────────────────────────────────────────────────
class CyclicDependencyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CyclicDependencyError';
    this.code = 'CYCLIC_DEPENDENCY';
  }
}

// ── TaskDependency record ──────────────────────────────────────────────────
class TaskDependency {
  constructor(data) {
    this.id          = data.id          || `dep_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    this.taskId      = data.taskId;      // the dependent task (downstream)
    this.dependsOnId = data.dependsOnId; // the blocker task (upstream)
    this.workspaceId = data.workspaceId;
    this.type        = data.type        || 'finish-to-start'; // finish-to-start | start-to-start | finish-to-finish
    this.createdAt   = data.createdAt   || new Date().toISOString();
    this.createdBy   = data.createdBy   || null;
  }

  toJSON() {
    return {
      id:          this.id,
      taskId:      this.taskId,
      dependsOnId: this.dependsOnId,
      workspaceId: this.workspaceId,
      type:        this.type,
      createdAt:   this.createdAt,
      createdBy:   this.createdBy,
    };
  }
}

// ── TaskDependencyService ─────────────────────────────────────────────────
class TaskDependencyService {
  /**
   * @param {object} opts
   * @param {object} opts.logger   pino logger
   * @param {object} opts.db       pg pool (optional)
   */
  constructor({ logger = null, db = null } = {}) {
    /** @type {Map<string, TaskDependency>} dep id → dependency */
    this._deps   = new Map();
    this._db     = db;
    this._log    = logger || { info: () => {}, warn: () => {} };
    this._version = 'V160';
  }

  setDb(db) { this._db = db; }

  // ── add dependency ────────────────────────────────────────────────────────
  async addDependency(workspaceId, taskId, dependsOnId, opts = {}) {
    if (!taskId)      throw new Error('taskId required');
    if (!dependsOnId) throw new Error('dependsOnId required');
    if (taskId === dependsOnId) throw new CyclicDependencyError('Task cannot depend on itself');

    // Check for existing
    const exists = [...this._deps.values()].find(
      d => d.taskId === taskId && d.dependsOnId === dependsOnId && d.workspaceId === workspaceId
    );
    if (exists) return { dependency: exists.toJSON(), alreadyExists: true };

    // Build existing graph and check for cycle
    await this._loadFromDb(workspaceId);
    const newGraph = this._buildGraph(workspaceId);
    // Tentatively add new edge
    if (!newGraph[taskId])      newGraph[taskId]      = [];
    if (!newGraph[dependsOnId]) newGraph[dependsOnId] = [];
    newGraph[taskId].push(dependsOnId);

    if (this._hasCycle(newGraph)) {
      throw new CyclicDependencyError(
        `Adding dependency ${taskId} → ${dependsOnId} would create a cycle`
      );
    }

    const dep = new TaskDependency({
      taskId, dependsOnId, workspaceId,
      type:      opts.type      || 'finish-to-start',
      createdBy: opts.createdBy || null,
    });

    this._deps.set(dep.id, dep);

    if (this._db) {
      try {
        await this._db.query(
          `INSERT INTO task_dependencies (id, workspace_id, task_id, depends_on_id, type, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (workspace_id, task_id, depends_on_id) DO NOTHING`,
          [dep.id, workspaceId, taskId, dependsOnId, dep.type, dep.createdBy, dep.createdAt]
        );
      } catch (err) {
        this._log.warn({ err: err.message }, '[depService] DB insert failed (in-memory persisted)');
      }
    }

    this._log.info({ taskId, dependsOnId, workspaceId }, '[depService] dependency added');
    return { dependency: dep.toJSON(), alreadyExists: false };
  }

  // ── remove dependency ─────────────────────────────────────────────────────
  async removeDependency(workspaceId, taskId, dependsOnId) {
    const dep = [...this._deps.values()].find(
      d => d.taskId === taskId && d.dependsOnId === dependsOnId && d.workspaceId === workspaceId
    );
    if (dep) this._deps.delete(dep.id);

    if (this._db) {
      try {
        await this._db.query(
          `DELETE FROM task_dependencies WHERE workspace_id=$1 AND task_id=$2 AND depends_on_id=$3`,
          [workspaceId, taskId, dependsOnId]
        );
      } catch (err) {
        this._log.warn({ err: err.message }, '[depService] DB delete failed');
      }
    }

    return dep ? dep.toJSON() : null;
  }

  // ── get dependencies for a task ───────────────────────────────────────────
  async getDependencies(workspaceId, taskId) {
    await this._loadFromDb(workspaceId);
    const blocking  = [...this._deps.values()].filter(d => d.workspaceId === workspaceId && d.taskId      === taskId);
    const blockedBy = [...this._deps.values()].filter(d => d.workspaceId === workspaceId && d.dependsOnId === taskId);
    return {
      taskId,
      dependsOn:  blocking.map(d => d.toJSON()),   // tasks this task waits for
      requiredBy: blockedBy.map(d => d.toJSON()),   // tasks waiting for this task
    };
  }

  // ── get full dependency tree for a task (BFS) ────────────────────────────
  async getDependencyTree(workspaceId, rootTaskId, maxDepth = 10) {
    await this._loadFromDb(workspaceId);
    const visited = new Set();
    const tree    = { taskId: rootTaskId, dependsOn: [], depth: 0 };

    const expand = (node, depth) => {
      if (depth >= maxDepth) return;
      const deps = [...this._deps.values()].filter(
        d => d.workspaceId === workspaceId && d.taskId === node.taskId
      );
      for (const d of deps) {
        if (!visited.has(d.dependsOnId)) {
          visited.add(d.dependsOnId);
          const child = { taskId: d.dependsOnId, type: d.type, dependsOn: [], depth: depth + 1 };
          node.dependsOn.push(child);
          expand(child, depth + 1);
        }
      }
    };

    expand(tree, 0);
    return tree;
  }

  // ── topological sort (Kahn's algorithm) for workspace tasks ──────────────
  async topologicalSort(workspaceId) {
    await this._loadFromDb(workspaceId);
    const graph   = this._buildGraph(workspaceId);
    const allNodes = new Set([
      ...Object.keys(graph),
      ...[...this._deps.values()].filter(d => d.workspaceId === workspaceId).map(d => d.dependsOnId),
    ]);

    // Build in-degree map
    const inDegree = {};
    for (const n of allNodes) inDegree[n] = 0;
    for (const [task, blockers] of Object.entries(graph)) {
      for (const b of blockers) {
        if (inDegree[task] !== undefined) inDegree[task]++;
      }
    }

    const queue  = [...allNodes].filter(n => (inDegree[n] || 0) === 0);
    const sorted = [];

    while (queue.length) {
      const task = queue.shift();
      sorted.push(task);
      // find tasks that depend on `task`
      for (const d of [...this._deps.values()].filter(d => d.workspaceId === workspaceId && d.dependsOnId === task)) {
        inDegree[d.taskId]--;
        if (inDegree[d.taskId] === 0) queue.push(d.taskId);
      }
    }

    if (sorted.length !== allNodes.size) {
      throw new CyclicDependencyError('Cyclic dependency detected in workspace task graph');
    }

    return sorted;
  }

  // ── check if task is blocked (has incomplete blockers) ──────────────────
  async isTaskBlocked(workspaceId, taskId, taskStatusResolver) {
    const { dependsOn } = await this.getDependencies(workspaceId, taskId);
    if (dependsOn.length === 0) return { blocked: false, blockers: [] };

    const blockers = [];
    for (const dep of dependsOn) {
      if (typeof taskStatusResolver === 'function') {
        const status = await taskStatusResolver(dep.dependsOnId);
        if (!['done', 'cancelled'].includes(status)) {
          blockers.push({ taskId: dep.dependsOnId, type: dep.type });
        }
      }
    }

    return { blocked: blockers.length > 0, blockers };
  }

  // ── list all dependencies in workspace ───────────────────────────────────
  async listAll(workspaceId) {
    await this._loadFromDb(workspaceId);
    return [...this._deps.values()]
      .filter(d => d.workspaceId === workspaceId)
      .map(d => d.toJSON());
  }

  // ── stats ─────────────────────────────────────────────────────────────────
  stats(workspaceId = null) {
    let all = [...this._deps.values()];
    if (workspaceId) all = all.filter(d => d.workspaceId === workspaceId);
    const byType = {};
    for (const d of all) byType[d.type] = (byType[d.type] || 0) + 1;
    return {
      totalDependencies: all.length,
      byType,
      version: this._version,
    };
  }

  // ── private: load from DB (idempotent) ────────────────────────────────────
  async _loadFromDb(workspaceId) {
    if (!this._db) return;
    try {
      const r = await this._db.query(
        `SELECT * FROM task_dependencies WHERE workspace_id=$1`,
        [workspaceId]
      );
      for (const row of r.rows) {
        const id = row.id;
        if (!this._deps.has(id)) {
          this._deps.set(id, new TaskDependency({
            id,
            taskId:      row.task_id,
            dependsOnId: row.depends_on_id,
            workspaceId: row.workspace_id,
            type:        row.type,
            createdBy:   row.created_by,
            createdAt:   row.created_at,
          }));
        }
      }
    } catch (err) {
      this._log.warn({ err: err.message }, '[depService] DB load failed, using in-memory');
    }
  }

  // ── private: build adjacency graph {taskId: [dependsOnId, ...]} ──────────
  _buildGraph(workspaceId) {
    const graph = {};
    for (const d of this._deps.values()) {
      if (d.workspaceId !== workspaceId) continue;
      if (!graph[d.taskId]) graph[d.taskId] = [];
      graph[d.taskId].push(d.dependsOnId);
    }
    return graph;
  }

  // ── private: DFS cycle detection ─────────────────────────────────────────
  _hasCycle(graph) {
    const visited  = new Set();
    const inStack  = new Set();

    const dfs = (node) => {
      if (inStack.has(node))  return true;  // back edge = cycle
      if (visited.has(node))  return false;
      visited.add(node);
      inStack.add(node);
      for (const neighbor of (graph[node] || [])) {
        if (dfs(neighbor)) return true;
      }
      inStack.delete(node);
      return false;
    };

    for (const node of Object.keys(graph)) {
      if (dfs(node)) return true;
    }
    return false;
  }
}

const defaultDependencyService = new TaskDependencyService();

module.exports = {
  TaskDependencyService,
  TaskDependency,
  CyclicDependencyError,
  defaultDependencyService,
};
