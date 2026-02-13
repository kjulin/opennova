import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import {
  loadTasks,
  createTask,
  updateTask,
  archiveTask,
  getTask,
} from "./storage.js";
import type { Task } from "./types.js";

export function createTasklistMcpServer(
  agentId: string,
  workspaceDir: string
): McpSdkServerConfigWithInstance {
  function getVisibleTasks(): Task[] {
    const tasks = loadTasks(workspaceDir);
    return tasks.filter(
      (t) => t.agentId === agentId || t.assignee === agentId
    );
  }

  function canModifyTask(task: Task): boolean {
    return task.agentId === agentId;
  }

  function canCompleteTask(task: Task): boolean {
    return task.agentId === agentId || task.assignee === agentId;
  }

  return createSdkMcpServer({
    name: "tasklist",
    tools: [
      tool(
        "list_tasks",
        "List tasks you created or tasks assigned to you",
        {},
        async () => {
          const tasks = getVisibleTasks();
          const created = tasks.filter((t) => t.agentId === agentId);
          const assigned = tasks.filter(
            (t) => t.assignee === agentId && t.agentId !== agentId
          );
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ created, assignedToMe: assigned }, null, 2),
              },
            ],
          };
        }
      ),
      tool(
        "create_task",
        "Create a new task. By default assigns to the user unless you specify another agent.",
        {
          title: z.string().describe("Brief title for the task"),
          rationale: z
            .string()
            .describe("Why this task needs to be done"),
          instructions: z
            .string()
            .describe("Detailed instructions on how to complete the task"),
          assignee: z
            .string()
            .optional()
            .default("user")
            .describe("Who should complete this task: 'user' or an agent ID"),
          projectId: z
            .string()
            .optional()
            .describe("Optional project ID to link this task to"),
          phaseId: z
            .string()
            .optional()
            .describe("Optional phase ID within the project"),
        },
        async (args) => {
          const task = createTask(workspaceDir, {
            agentId,
            assignee: args.assignee,
            title: args.title,
            rationale: args.rationale,
            instructions: args.instructions,
            projectId: args.projectId,
            phaseId: args.phaseId,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `Created task: ${task.title} (id: ${task.id})`,
              },
            ],
          };
        }
      ),
      tool(
        "update_task",
        "Update a task you created",
        {
          id: z.string().describe("Task ID to update"),
          title: z.string().optional().describe("New title"),
          rationale: z.string().optional().describe("New rationale"),
          instructions: z.string().optional().describe("New instructions"),
        },
        async (args) => {
          const task = getTask(workspaceDir, args.id);
          if (!task) {
            return {
              content: [{ type: "text" as const, text: "Task not found" }],
              isError: true,
            };
          }
          if (!canModifyTask(task)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "You can only update tasks you created",
                },
              ],
              isError: true,
            };
          }
          const updated = updateTask(workspaceDir, args.id, {
            title: args.title,
            rationale: args.rationale,
            instructions: args.instructions,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `Updated task: ${updated?.title}`,
              },
            ],
          };
        }
      ),
      tool(
        "complete_task",
        "Mark a task as done. You can complete tasks you created or tasks assigned to you.",
        {
          id: z.string().describe("Task ID to complete"),
        },
        async (args) => {
          const task = getTask(workspaceDir, args.id);
          if (!task) {
            return {
              content: [{ type: "text" as const, text: "Task not found" }],
              isError: true,
            };
          }
          if (!canCompleteTask(task)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "You can only complete tasks you created or tasks assigned to you",
                },
              ],
              isError: true,
            };
          }
          const updated = updateTask(workspaceDir, args.id, { status: "done" });
          return {
            content: [
              {
                type: "text" as const,
                text: `Completed task: ${updated?.title}`,
              },
            ],
          };
        }
      ),
      tool(
        "archive_task",
        "Archive a task you created. Use for completed tasks or tasks no longer relevant. Moves it to history.",
        {
          id: z.string().describe("Task ID to archive"),
        },
        async (args) => {
          const task = getTask(workspaceDir, args.id);
          if (!task) {
            return {
              content: [{ type: "text" as const, text: "Task not found" }],
              isError: true,
            };
          }
          if (!canModifyTask(task)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "You can only archive tasks you created",
                },
              ],
              isError: true,
            };
          }
          archiveTask(workspaceDir, args.id);
          return {
            content: [
              { type: "text" as const, text: `Archived task: ${task.title}` },
            ],
          };
        }
      ),
      tool(
        "update_remarks",
        "Update the remarks on a task. Both creator and assignee can update remarks to communicate about progress or clarifications.",
        {
          id: z.string().describe("Task ID to update"),
          remarks: z.string().describe("New remarks for the task"),
        },
        async (args) => {
          const task = getTask(workspaceDir, args.id);
          if (!task) {
            return {
              content: [{ type: "text" as const, text: "Task not found" }],
              isError: true,
            };
          }
          if (!canCompleteTask(task)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "You can only update remarks on tasks you created or tasks assigned to you",
                },
              ],
              isError: true,
            };
          }
          const updated = updateTask(workspaceDir, args.id, {
            remarks: args.remarks,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `Updated remarks on task: ${updated?.title}`,
              },
            ],
          };
        }
      ),
    ],
  });
}
