import { z } from "zod/v4";

export const PhaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.enum(["pending", "in_progress", "review", "done"]),
});

export type Phase = z.infer<typeof PhaseSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  lead: z.string(), // agent-id — who drives this project
  title: z.string(),
  description: z.string(),
  status: z.enum(["draft", "active", "completed", "cancelled"]),
  artifacts: z.array(z.string()), // file paths
  phases: z.array(PhaseSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Project = z.infer<typeof ProjectSchema>;
