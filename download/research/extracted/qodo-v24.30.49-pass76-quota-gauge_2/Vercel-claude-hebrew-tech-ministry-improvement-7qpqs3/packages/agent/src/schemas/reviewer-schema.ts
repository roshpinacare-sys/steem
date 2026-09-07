import { z } from "zod";

export const AnnotationSchema = z.object({
  path: z.string().min(1),
  start_line: z.number().int().min(1),
  end_line: z.number().int().min(1),
  annotation_level: z.enum(["notice", "warning", "failure"]),
  message: z.string().min(1),
}).strict().refine((data) => data.end_line >= data.start_line, {
  message: "end_line must be >= start_line",
});

export const ReviewerSchema = z.object({
  summary: z.string().min(1),
  annotations: z.array(AnnotationSchema),
}).strict();

export type ReviewerOutput = z.infer<typeof ReviewerSchema>;
