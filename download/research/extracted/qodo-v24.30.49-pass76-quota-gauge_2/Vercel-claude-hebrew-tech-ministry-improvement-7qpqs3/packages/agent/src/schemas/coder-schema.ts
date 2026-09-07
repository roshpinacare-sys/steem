import { z } from "zod";

export const FileChangeSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
}).strict();

export const CoderSchema = z.object({
  diff: z.string(),
  files: z.array(FileChangeSchema).min(1),
}).strict();

export type CoderOutput = z.infer<typeof CoderSchema>;
