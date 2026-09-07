import type { DurableStepContext, DurableWorkflow } from "./types";

export type DurablePlanStepState =
  | "pending"
  | "retrying"
  | "running"
  | "completed"
  | "failed"
  | "blocked";

export interface DurablePlanStep {
  id: string;
  dependsOn: string[];
}

export interface DurableStepExecutionResult {
  stepId: string;
  ok: boolean;
  output?: unknown;
  error?: string;
}

export interface DurableStepRunAdapter<TPayload, TResult> {
  initialize(payload: TPayload): Promise<void>;
  loadOrCreatePlan(payload: TPayload): Promise<DurablePlanStep[]>;
  getStepState(stepId: string): Promise<DurablePlanStepState>;
  recoverRunningStep(stepId: string): Promise<void>;
  executeStep(
    stepId: string,
    context: { payload: TPayload; signal: AbortSignal },
  ): Promise<DurableStepExecutionResult>;
  finalize(
    payload: TPayload,
    summary: {
      plan: DurablePlanStep[];
      states: Record<string, DurablePlanStepState>;
      completed: string[];
      failed: string[];
      blocked: string[];
    },
  ): Promise<TResult>;
}

export interface StepSlotOutput {
  slot: number;
  stepId?: string;
  state: "executed" | "already_completed" | "terminal_failure" | "all_complete";
  ok: boolean;
  output?: unknown;
  error?: string;
}

function normalizePlan(plan: DurablePlanStep[], maximumSteps: number): DurablePlanStep[] {
  if (!Array.isArray(plan) || plan.length === 0) throw new Error("durable_plan_empty");
  if (plan.length > maximumSteps) throw new Error(`durable_plan_too_large:${plan.length}:${maximumSteps}`);
  const ids = new Set<string>();
  for (const step of plan) {
    if (!step.id.trim()) throw new Error("durable_plan_step_id_required");
    if (ids.has(step.id)) throw new Error(`durable_plan_duplicate_step:${step.id}`);
    ids.add(step.id);
  }
  for (const step of plan) {
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency)) throw new Error(`durable_plan_missing_dependency:${step.id}:${dependency}`);
      if (dependency === step.id) throw new Error(`durable_plan_self_dependency:${step.id}`);
    }
  }
  const remaining = new Map(plan.map((step) => [step.id, new Set(step.dependsOn)]));
  const ready = [...remaining.entries()].filter(([, deps]) => deps.size === 0).map(([id]) => id);
  let visited = 0;
  while (ready.length) {
    const id = ready.shift()!;
    if (!remaining.has(id)) continue;
    remaining.delete(id);
    visited += 1;
    for (const [candidate, deps] of remaining) {
      deps.delete(id);
      if (deps.size === 0) ready.push(candidate);
    }
  }
  if (visited !== plan.length) throw new Error("durable_plan_cycle_detected");
  return plan.map((step) => ({ id: step.id, dependsOn: [...step.dependsOn] }));
}

async function inspectPlan<TPayload, TResult>(
  adapter: DurableStepRunAdapter<TPayload, TResult>,
  plan: DurablePlanStep[],
): Promise<Record<string, DurablePlanStepState>> {
  const entries = await Promise.all(plan.map(async (step) => [step.id, await adapter.getStepState(step.id)] as const));
  return Object.fromEntries(entries);
}

export function createStepDurableWorkflow<TPayload, TResult>(
  adapter: DurableStepRunAdapter<TPayload, TResult>,
  maximumSteps: number,
): DurableWorkflow<TPayload, TResult> {
  if (!Number.isInteger(maximumSteps) || maximumSteps < 1 || maximumSteps > 100) {
    throw new Error(`invalid_durable_step_limit:${maximumSteps}`);
  }

  const slots = Array.from({ length: maximumSteps }, (_, slot) => ({
    id: `execute_slot_${slot}`,
    operation: "agent_step.execute_idempotently",
    kind: "idempotent" as const,
    async run({ payload, outputs, signal }: DurableStepContext<TPayload>): Promise<StepSlotOutput> {
      const plan = normalizePlan(outputs.create_plan as DurablePlanStep[], maximumSteps);
      const states = await inspectPlan(adapter, plan);
      const failed = plan.filter((step) => states[step.id] === "failed" || states[step.id] === "blocked");
      if (failed.length) {
        return {
          slot,
          stepId: failed[0].id,
          state: "terminal_failure",
          ok: false,
          error: `dependency_graph_terminal:${failed.map((step) => `${step.id}:${states[step.id]}`).join(",")}`,
        };
      }
      const unfinished = plan.filter((step) => states[step.id] !== "completed");
      if (!unfinished.length) return { slot, state: "all_complete", ok: true };

      const ready = unfinished.find((step) =>
        step.dependsOn.every((dependency) => states[dependency] === "completed"),
      );
      if (!ready) {
        return {
          slot,
          state: "terminal_failure",
          ok: false,
          error: "durable_plan_no_ready_step",
        };
      }
      if (states[ready.id] === "completed") {
        return { slot, stepId: ready.id, state: "already_completed", ok: true };
      }
      if (states[ready.id] === "running") await adapter.recoverRunningStep(ready.id);
      const result = await adapter.executeStep(ready.id, { payload, signal });
      return {
        slot,
        stepId: ready.id,
        state: "executed",
        ok: result.ok,
        output: result.output,
        error: result.error,
      };
    },
  }));

  return {
    name: "agent_run_steps_v2",
    steps: [
      {
        id: "initialize_run",
        operation: "agent_run.initialize_idempotently",
        kind: "idempotent",
        async run({ payload }) {
          await adapter.initialize(payload);
          return { initialized: true };
        },
      },
      {
        id: "create_plan",
        operation: "agent_plan.persist_idempotently",
        kind: "idempotent",
        async run({ payload }) {
          return normalizePlan(await adapter.loadOrCreatePlan(payload), maximumSteps);
        },
      },
      ...slots,
      {
        id: "finalize_run",
        operation: "agent_run.finalize_idempotently",
        kind: "idempotent",
        async run({ payload, outputs }) {
          const plan = normalizePlan(outputs.create_plan as DurablePlanStep[], maximumSteps);
          const states = await inspectPlan(adapter, plan);
          const completed = plan.filter((step) => states[step.id] === "completed").map((step) => step.id);
          const failed = plan.filter((step) => states[step.id] === "failed").map((step) => step.id);
          const blocked = plan.filter((step) => states[step.id] === "blocked").map((step) => step.id);
          if (completed.length !== plan.length && failed.length === 0 && blocked.length === 0) {
            throw new Error(`durable_run_incomplete:${completed.length}:${plan.length}`);
          }
          return adapter.finalize(payload, { plan, states, completed, failed, blocked });
        },
      },
    ],
    buildResult(outputs) {
      return outputs.finalize_run as TResult;
    },
  };
}
