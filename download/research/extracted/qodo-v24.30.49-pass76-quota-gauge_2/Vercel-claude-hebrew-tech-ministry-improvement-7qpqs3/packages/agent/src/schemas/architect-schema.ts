import { z } from "zod";

export const StepSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  files: z.array(z.string().min(1)),
}).strict();

export const ArchitectSchema = z.object({
  steps: z.array(StepSchema).min(1),
  risk: z.enum(["low", "medium", "high"]),
  prefetch: z.array(z.string().min(1)).optional(),
}).strict();

export type ArchitectOutput = z.infer<typeof ArchitectSchema>;
