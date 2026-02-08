import { z } from "zod/v4";

export const TriggerSchema = z.object({
  id: z.string(),
  channel: z.string(),
  cron: z.string(),
  tz: z.string().optional(),
  prompt: z.string(),
  expiresAt: z.string().optional(),
  lastRun: z.string(),
});

export type Trigger = z.infer<typeof TriggerSchema>;
