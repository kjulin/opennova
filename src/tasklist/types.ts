import { z } from "zod/v4";

export const TaskSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  assignee: z.string(),
  title: z.string(),
  rationale: z.string(),
  instructions: z.string(),
  remarks: z.string().optional(),
  status: z.enum(["open", "in_progress", "review", "done", "failed", "dismissed"]),
  threadId: z.string().optional(),
  projectId: z.string().optional(), // links task to a project
  phaseId: z.string().optional(), // links task to a specific phase
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Task = z.infer<typeof TaskSchema>;
