import { z } from "zod";

const stepSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2_000).default(""),
  dependsOn: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
});

const rawPlanSchema = z.object({
  steps: z.array(stepSchema).min(1),
});

export type ExecutionPlan = z.infer<typeof rawPlanSchema>;

export class InvalidExecutionPlanError extends Error {
  readonly code:
    | "schema"
    | "too_many_steps"
    | "duplicate_step"
    | "unknown_dependency"
    | "self_dependency"
    | "cycle";

  constructor(
    code: InvalidExecutionPlanError["code"],
    message: string,
  ) {
    super(message);
    this.name = "InvalidExecutionPlanError";
    this.code = code;
  }
}

export function validateExecutionPlan(
  input: unknown,
  maxSteps: number,
): ExecutionPlan {
  const parsed = rawPlanSchema.safeParse(input);
  if (!parsed.success) {
    throw new InvalidExecutionPlanError("schema", "Plan does not match the execution-plan schema.");
  }

  const plan = parsed.data;
  if (plan.steps.length > maxSteps) {
    throw new InvalidExecutionPlanError(
      "too_many_steps",
      `Plan contains ${plan.steps.length} steps; maximum is ${maxSteps}.`,
    );
  }

  const names = new Set<string>();
  for (const step of plan.steps) {
    if (names.has(step.name)) {
      throw new InvalidExecutionPlanError(
        "duplicate_step",
        `Duplicate step name: ${step.name}.`,
      );
    }
    names.add(step.name);
  }

  for (const step of plan.steps) {
    const deps = new Set<string>();
    for (const dep of step.dependsOn) {
      if (dep === step.name) {
        throw new InvalidExecutionPlanError(
          "self_dependency",
          `Step ${step.name} depends on itself.`,
        );
      }
      if (!names.has(dep)) {
        throw new InvalidExecutionPlanError(
          "unknown_dependency",
          `Step ${step.name} depends on unknown step ${dep}.`,
        );
      }
      deps.add(dep);
    }
    step.dependsOn = [...deps];
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byName = new Map(plan.steps.map((step) => [step.name, step]));

  const visit = (name: string): void => {
    if (visiting.has(name)) {
      throw new InvalidExecutionPlanError("cycle", `Dependency cycle includes ${name}.`);
    }
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dep of byName.get(name)?.dependsOn ?? []) visit(dep);
    visiting.delete(name);
    visited.add(name);
  };

  for (const name of names) visit(name);
  return plan;
}
