import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import {
  loadProjects,
  createProject,
  updateProject,
  updatePhase,
  getProject,
} from "./storage.js";

export function createProjectsMcpServer(
  agentId: string,
  workspaceDir: string
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "projects",
    tools: [
      tool(
        "list_projects",
        "List all projects, or get a single project by ID with full phase details",
        {
          id: z.string().optional().describe("Optional project ID to filter to a single project"),
        },
        async (args) => {
          if (args.id) {
            const project = getProject(workspaceDir, args.id);
            if (!project) {
              return {
                content: [{ type: "text" as const, text: "Project not found" }],
                isError: true,
              };
            }
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(project, null, 2),
                },
              ],
            };
          }
          const projects = loadProjects(workspaceDir);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(projects, null, 2),
              },
            ],
          };
        }
      ),
      tool(
        "create_project",
        "Create a new project. You become the project lead.",
        {
          title: z.string().describe("Project title"),
          description: z.string().describe("Project description and goals"),
          phases: z
            .array(
              z.object({
                title: z.string().describe("Phase title"),
                description: z.string().describe("Phase description"),
              })
            )
            .describe("Ordered list of project phases"),
        },
        async (args) => {
          const project = createProject(workspaceDir, {
            lead: agentId,
            title: args.title,
            description: args.description,
            phases: args.phases,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `Created project: ${project.title} (id: ${project.id}) with ${project.phases.length} phases`,
              },
            ],
          };
        }
      ),
      tool(
        "update_project",
        "Update a project you lead. Only the project lead can update.",
        {
          id: z.string().describe("Project ID to update"),
          title: z.string().optional().describe("New title"),
          description: z.string().optional().describe("New description"),
          status: z
            .enum(["active", "completed", "cancelled"])
            .optional()
            .describe("New status: draft→active, active→completed|cancelled"),
          artifacts: z
            .array(z.string())
            .optional()
            .describe("File paths to project artifacts (replaces existing list)"),
        },
        async (args) => {
          const project = getProject(workspaceDir, args.id);
          if (!project) {
            return {
              content: [{ type: "text" as const, text: "Project not found" }],
              isError: true,
            };
          }
          if (project.lead !== agentId) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Only the project lead can update this project",
                },
              ],
              isError: true,
            };
          }
          // Validate status transitions
          if (args.status) {
            const validTransitions: Record<string, string[]> = {
              draft: ["active"],
              active: ["completed", "cancelled"],
            };
            const allowed = validTransitions[project.status] ?? [];
            if (!allowed.includes(args.status)) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Invalid status transition: ${project.status} → ${args.status}`,
                  },
                ],
                isError: true,
              };
            }
          }
          const updated = updateProject(workspaceDir, args.id, {
            title: args.title,
            description: args.description,
            status: args.status,
            artifacts: args.artifacts,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: `Updated project: ${updated?.title}`,
              },
            ],
          };
        }
      ),
      tool(
        "update_phase",
        "Update a phase in a project you lead. Only the project lead can update phases.",
        {
          id: z.string().describe("Project ID"),
          phaseId: z.string().describe("Phase ID to update"),
          status: z
            .enum(["in_progress", "review", "done"])
            .optional()
            .describe("New status: pending→in_progress→review→done, review→in_progress (rework)"),
          description: z.string().optional().describe("Updated phase description"),
        },
        async (args) => {
          const project = getProject(workspaceDir, args.id);
          if (!project) {
            return {
              content: [{ type: "text" as const, text: "Project not found" }],
              isError: true,
            };
          }
          if (project.lead !== agentId) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Only the project lead can update phases",
                },
              ],
              isError: true,
            };
          }
          const phase = project.phases.find((p) => p.id === args.phaseId);
          if (!phase) {
            return {
              content: [{ type: "text" as const, text: "Phase not found" }],
              isError: true,
            };
          }
          // Validate status transitions
          if (args.status) {
            const validTransitions: Record<string, string[]> = {
              pending: ["in_progress"],
              in_progress: ["review"],
              review: ["in_progress", "done"], // in_progress = rework
            };
            const allowed = validTransitions[phase.status] ?? [];
            if (!allowed.includes(args.status)) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Invalid phase status transition: ${phase.status} → ${args.status}`,
                  },
                ],
                isError: true,
              };
            }
          }
          const updated = updatePhase(workspaceDir, args.id, args.phaseId, {
            status: args.status,
            description: args.description,
          });
          const updatedPhase = updated?.phases.find((p) => p.id === args.phaseId);
          return {
            content: [
              {
                type: "text" as const,
                text: `Updated phase: ${updatedPhase?.title} (status: ${updatedPhase?.status})`,
              },
            ],
          };
        }
      ),
    ],
  });
}
