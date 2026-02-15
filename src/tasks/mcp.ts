import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import {
  loadTasks,
  getTask,
  createTask,
  updateTask,
  updateSteps,
  cancelTask,
  completeTask,
} from "./storage.js";
import type { Task, Step } from "./types.js";

const StepSchema = z.object({
  title: z.string().describe("Step title"),
  done: z.boolean().describe("Whether the step is completed"),
});

function formatTask(task: Task): string {
  const steps = task.steps.length > 0
    ? "\nSteps:\n" + task.steps.map((s: Step, i: number) =>
        `  ${i + 1}. ${s.done ? "✓" : "○"} ${s.title}`
      ).join("\n")
    : "";

  return `Task: ${task.title}
ID: ${task.id}
Status: ${task.status}
Owner: ${task.owner}
Created by: ${task.createdBy}
Thread: ${task.threadId ?? "(not yet created)"}${steps}
Created: ${task.createdAt}
Updated: ${task.updatedAt}`;
}

export function createTasksMcpServer(
  agentId: string,
  workspaceDir: string,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "tasks",
    tools: [
      tool(
        "create_task",
        "Create a new task. The task will be owned by the specified owner (defaults to you). A dedicated thread will be created for the task.",
        {
          title: z.string().describe("What is the work - clear, actionable title"),
          description: z.string().describe("Context and brief for the task"),
          owner: z.string().optional().describe("Who drives this task - agent ID or 'user'. Defaults to you."),
        },
        async (args) => {
          const task = createTask({
            workspaceDir,
            input: {
              title: args.title,
              description: args.description,
              ...(args.owner !== undefined ? { owner: args.owner } : {}),
            },
            createdBy: agentId,
          });

          // Note: Thread creation will be added in Milestone 3

          return {
            content: [{
              type: "text" as const,
              text: `Created task:\n\n${formatTask(task)}`,
            }],
          };
        },
      ),

      tool(
        "list_tasks",
        "List all active and waiting tasks. Returns all tasks visible to all agents.",
        {},
        async () => {
          const tasks = loadTasks(workspaceDir);

          if (tasks.length === 0) {
            return {
              content: [{
                type: "text" as const,
                text: "No active tasks.",
              }],
            };
          }

          const grouped = {
            active: tasks.filter(t => t.status === "active"),
            waiting: tasks.filter(t => t.status === "waiting"),
          };

          let output = "";
          if (grouped.active.length > 0) {
            output += "## Active Tasks\n\n";
            output += grouped.active.map(t =>
              `- **${t.title}** (${t.id})\n  Owner: ${t.owner} | Steps: ${t.steps.filter(s => s.done).length}/${t.steps.length}`
            ).join("\n\n");
          }
          if (grouped.waiting.length > 0) {
            if (output) output += "\n\n";
            output += "## Waiting Tasks\n\n";
            output += grouped.waiting.map(t =>
              `- **${t.title}** (${t.id})\n  Owner: ${t.owner} | Waiting for input`
            ).join("\n\n");
          }

          return {
            content: [{
              type: "text" as const,
              text: output,
            }],
          };
        },
      ),

      tool(
        "get_task",
        "Get full details of a specific task by ID.",
        {
          id: z.string().describe("Task ID"),
        },
        async (args) => {
          const task = getTask(workspaceDir, args.id);

          if (!task) {
            return {
              content: [{
                type: "text" as const,
                text: `Task not found: ${args.id}`,
              }],
              isError: true,
            };
          }

          return {
            content: [{
              type: "text" as const,
              text: formatTask(task) + `\n\nDescription:\n${task.description}`,
            }],
          };
        },
      ),

      tool(
        "update_task",
        "Update a task's title, description, status, or owner.",
        {
          id: z.string().describe("Task ID"),
          title: z.string().optional().describe("New title"),
          description: z.string().optional().describe("New description"),
          status: z.enum(["active", "waiting", "done"]).optional().describe("New status. 'done' moves task to history."),
          owner: z.string().optional().describe("New owner - agent ID or 'user'"),
        },
        async (args) => {
          const { id, ...updates } = args;

          // Filter out undefined values
          const input: Record<string, unknown> = {};
          if (updates.title !== undefined) input.title = updates.title;
          if (updates.description !== undefined) input.description = updates.description;
          if (updates.status !== undefined) input.status = updates.status;
          if (updates.owner !== undefined) input.owner = updates.owner;

          if (Object.keys(input).length === 0) {
            return {
              content: [{
                type: "text" as const,
                text: "No updates provided.",
              }],
              isError: true,
            };
          }

          const task = updateTask(workspaceDir, id, input);

          if (!task) {
            return {
              content: [{
                type: "text" as const,
                text: `Task not found: ${id}`,
              }],
              isError: true,
            };
          }

          const action = task.status === "done" ? "completed and archived" : "updated";
          return {
            content: [{
              type: "text" as const,
              text: `Task ${action}:\n\n${formatTask(task)}`,
            }],
          };
        },
      ),

      tool(
        "update_steps",
        "Replace the task's steps array. Use this to set your plan and track progress.",
        {
          id: z.string().describe("Task ID"),
          steps: z.array(StepSchema).describe("New steps array"),
        },
        async (args) => {
          const task = updateSteps(workspaceDir, args.id, args.steps);

          if (!task) {
            return {
              content: [{
                type: "text" as const,
                text: `Task not found: ${args.id}`,
              }],
              isError: true,
            };
          }

          return {
            content: [{
              type: "text" as const,
              text: `Steps updated:\n\n${formatTask(task)}`,
            }],
          };
        },
      ),

      tool(
        "complete_task",
        "Mark a task as done and move it to history.",
        {
          id: z.string().describe("Task ID"),
        },
        async (args) => {
          const task = completeTask(workspaceDir, args.id);

          if (!task) {
            return {
              content: [{
                type: "text" as const,
                text: `Task not found: ${args.id}`,
              }],
              isError: true,
            };
          }

          return {
            content: [{
              type: "text" as const,
              text: `Task completed and archived:\n\n${formatTask(task)}`,
            }],
          };
        },
      ),

      tool(
        "cancel_task",
        "Cancel a task and move it to history. Use when a task is no longer needed.",
        {
          id: z.string().describe("Task ID"),
        },
        async (args) => {
          const task = cancelTask(workspaceDir, args.id);

          if (!task) {
            return {
              content: [{
                type: "text" as const,
                text: `Task not found: ${args.id}`,
              }],
              isError: true,
            };
          }

          return {
            content: [{
              type: "text" as const,
              text: `Task canceled and archived:\n\n${formatTask(task)}`,
            }],
          };
        },
      ),
    ],
  });
}
