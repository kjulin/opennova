import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { threadStore } from "#core/threads/index.js";
import {
  loadTasks,
  loadHistory,
  getTask,
  createTask,
  updateTask,
  updateSteps,
  cancelTask,
  completeTask,
  linkSubtask,
  addResource,
  removeResource,
  isValidOwner,
} from "./storage.js";
import type { Task, Step, Resource } from "./types.js";
import { taskBus } from "./events.js";

const StepSchema = z.object({
  title: z.string().max(60).describe("Short step label (max 60 chars)"),
  details: z.string().optional().describe("Expanded description of the step"),
  done: z.boolean().describe("Whether the step is completed"),
});

function formatTask(task: Task): string {
  const steps = task.steps.length > 0
    ? "\nSteps:\n" + task.steps.map((s: Step, i: number) => {
        const subtask = s.taskId ? ` (#${s.taskId})` : "";
        const details = s.details ? `\n     ${s.details}` : "";
        return `  ${i + 1}. ${s.done ? "✓" : "○"} ${s.title}${subtask}${details}`;
      }).join("\n")
    : "";

  const resources = task.resources.length > 0
    ? "\nResources:\n" + task.resources.map((r: Resource, i: number) => {
        const label = r.label ? ` (${r.label})` : "";
        return `  ${i}. [${r.type}] ${r.value}${label}`;
      }).join("\n")
    : "";

  const parent = task.parentTaskId ? `\nParent: #${task.parentTaskId}` : "";

  return `Task #${task.id}: ${task.title}
Status: ${task.status}
Owner: ${task.owner}
Created by: ${task.createdBy}${parent}
Thread: ${task.threadId ?? "(not yet created)"}${steps}${resources}
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
          draft: z.boolean().optional().describe("If true, create as draft — visible but not executed until started. Default: false."),
        },
        async (args) => {
          // Validate owner exists
          const owner = args.owner ?? agentId;
          if (!isValidOwner(workspaceDir, owner)) {
            return {
              content: [{
                type: "text" as const,
                text: `Agent not found: ${owner}. Owner must be 'user' or an existing agent ID.`,
              }],
              isError: true,
            };
          }

          // Create the task first
          const task = createTask({
            workspaceDir,
            input: {
              title: args.title,
              description: args.description,
              ...(args.owner !== undefined ? { owner: args.owner } : {}),
              ...(args.draft ? { status: "draft" as const } : {}),
            },
            createdBy: agentId,
          });

          // Create dedicated thread for the task in the owner's agent directory
          const threadId = threadStore.create(task.owner, { taskId: task.id });

          // Update task with the thread ID
          const updatedTask = updateTask(workspaceDir, task.id, { threadId });

          taskBus.emit("task:created", { taskId: task.id });
          if (task.status !== "draft") {
            taskBus.emit("task:started", { taskId: task.id });
          }

          return {
            content: [{
              type: "text" as const,
              text: `Created task:\n\n${formatTask(updatedTask ?? task)}`,
            }],
          };
        },
      ),

      tool(
        "list_tasks",
        "List active tasks. By default shows only your own tasks.",
        {
          all: z.boolean().optional().describe("If true, show all active tasks across all agents. Default: false (your tasks only)."),
        },
        async (args) => {
          const allTasks = loadTasks(workspaceDir);
          const active = args.all
            ? allTasks.filter(t => t.status === "active" || t.status === "draft")
            : allTasks.filter(t => (t.status === "active" || t.status === "draft") && t.owner === agentId);

          if (active.length === 0) {
            return {
              content: [{
                type: "text" as const,
                text: "No active tasks.",
              }],
            };
          }

          const output = active.map(t =>
            `- **#${t.id}: ${t.title}**\n  Owner: ${t.owner} | Steps: ${t.steps.filter(s => s.done).length}/${t.steps.length}`
          ).join("\n\n");

          return {
            content: [{
              type: "text" as const,
              text: output,
            }],
          };
        },
      ),

      tool(
        "list_history",
        "List completed and canceled tasks from history. Returns the most recent entries first.",
        {
          limit: z.number().optional().describe("Maximum number of entries to return. Default: 20. Max: 100."),
        },
        async (args) => {
          const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
          const history = loadHistory(workspaceDir, limit);

          if (history.length === 0) {
            return {
              content: [{
                type: "text" as const,
                text: "No task history.",
              }],
            };
          }

          const output = history.map(t =>
            `- #${t.id}: ${t.title} [${t.status}]\n  Owner: ${t.owner} | Archived: ${t.archivedAt}`
          ).join("\n\n");

          return {
            content: [{
              type: "text" as const,
              text: `Task history (${history.length} entries):\n\n${output}`,
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
          status: z.enum(["draft", "active", "done"]).optional().describe("New status. 'active' starts a draft task. 'done' moves task to history."),
          owner: z.string().optional().describe("New owner - agent ID or 'user'"),
        },
        async (args) => {
          const { id, ...updates } = args;

          // Validate owner exists if being changed
          if (updates.owner !== undefined && !isValidOwner(workspaceDir, updates.owner)) {
            return {
              content: [{
                type: "text" as const,
                text: `Agent not found: ${updates.owner}. Owner must be 'user' or an existing agent ID.`,
              }],
              isError: true,
            };
          }

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

          // Emit events for status transitions
          if (updates.status === "active") {
            taskBus.emit("task:started", { taskId: id });
          } else if (updates.status === "done") {
            taskBus.emit("task:completed", { taskId: id });
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

          taskBus.emit("task:completed", { taskId: args.id });

          return {
            content: [{
              type: "text" as const,
              text: `Task completed and archived:\n\n${formatTask(task)}`,
            }],
          };
        },
      ),

      tool(
        "create_subtask",
        "Create a subtask linked to a specific step of your task. The subtask starts immediately — only create it when prior steps are complete and it's ready to begin. One subtask per step.",
        {
          taskId: z.string().describe("Your task ID"),
          stepIndex: z.number().describe("Step index (0-based)"),
          title: z.string().describe("Subtask title"),
          description: z.string().describe("Subtask description"),
          owner: z.string().optional().describe("Subtask owner - agent ID or 'user'. Defaults to you."),
        },
        async (args) => {
          // Verify the parent task exists and belongs to this agent
          const parentTask = getTask(workspaceDir, args.taskId);
          if (!parentTask) {
            return {
              content: [{
                type: "text" as const,
                text: `Task not found: #${args.taskId}`,
              }],
              isError: true,
            };
          }

          if (parentTask.owner !== agentId) {
            return {
              content: [{
                type: "text" as const,
                text: `You can only create subtasks for your own tasks. Task #${args.taskId} is owned by ${parentTask.owner}.`,
              }],
              isError: true,
            };
          }

          const step = parentTask.steps[args.stepIndex];
          if (!step) {
            return {
              content: [{
                type: "text" as const,
                text: `Step ${args.stepIndex} does not exist. Task #${args.taskId} has ${parentTask.steps.length} steps.`,
              }],
              isError: true,
            };
          }

          if (step.taskId) {
            return {
              content: [{
                type: "text" as const,
                text: `Step ${args.stepIndex} already has a linked subtask (#${step.taskId}).`,
              }],
              isError: true,
            };
          }

          // Validate subtask owner exists
          const subtaskOwner = args.owner ?? agentId;
          if (!isValidOwner(workspaceDir, subtaskOwner)) {
            return {
              content: [{
                type: "text" as const,
                text: `Agent not found: ${subtaskOwner}. Owner must be 'user' or an existing agent ID.`,
              }],
              isError: true,
            };
          }

          // Create the subtask
          const subtask = createTask({
            workspaceDir,
            input: {
              title: args.title,
              description: args.description,
              ...(args.owner !== undefined ? { owner: args.owner } : {}),
              parentTaskId: args.taskId,
            },
            createdBy: agentId,
          });

          // Create thread for the subtask
          const threadId = threadStore.create(subtask.owner, { taskId: subtask.id });
          updateTask(workspaceDir, subtask.id, { threadId });

          // Link subtask to the parent task's step
          const updatedParent = linkSubtask(workspaceDir, args.taskId, args.stepIndex, subtask.id);

          // Fire event to wake the subtask owner
          taskBus.emit("task:created", { taskId: subtask.id });
          taskBus.emit("task:started", { taskId: subtask.id });

          return {
            content: [{
              type: "text" as const,
              text: `Created subtask #${subtask.id} for step ${args.stepIndex} of task #${args.taskId}:\n\n${formatTask({ ...subtask, threadId })}\n\nParent task updated:\n${formatTask(updatedParent!)}`,
            }],
          };
        },
      ),

      tool(
        "add_resource",
        "Add a resource (URL or file path) to a task. Resources are visible in the task dashboard.",
        {
          id: z.string().describe("Task ID"),
          type: z.enum(["url", "file"]).describe("Resource type: 'url' for web links, 'file' for local file paths"),
          value: z.string().describe("The URL or absolute file path"),
          label: z.string().optional().describe("Display label for the resource"),
        },
        async (args) => {
          const resource: Resource = {
            type: args.type,
            value: args.value,
            ...(args.label !== undefined ? { label: args.label } : {}),
          };
          const task = addResource(workspaceDir, args.id, resource);
          if (!task) {
            return {
              content: [{ type: "text" as const, text: `Task not found: ${args.id}` }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text" as const, text: `Resource added to task #${args.id}:\n\n${formatTask(task)}` }],
          };
        },
      ),

      tool(
        "remove_resource",
        "Remove a resource from a task by its index (0-based).",
        {
          id: z.string().describe("Task ID"),
          index: z.number().describe("Resource index (0-based)"),
        },
        async (args) => {
          const task = removeResource(workspaceDir, args.id, args.index);
          if (!task) {
            return {
              content: [{ type: "text" as const, text: `Task or resource not found: task=${args.id} index=${args.index}` }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text" as const, text: `Resource removed from task #${args.id}:\n\n${formatTask(task)}` }],
          };
        },
      ),

      tool(
        "cancel_task",
        "Cancel a task and move it to history. Use when a task is no longer needed. Also cancels any linked subtasks.",
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

          taskBus.emit("task:canceled", { taskId: args.id });

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
