import { z } from "zod/v4";
import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
} from "@anthropic-ai/claude-agent-sdk";
import { slugify, listNotes, readNote, writeNote, deleteNote, noteExists } from "./storage.js";

export type OnShareNoteCallback = (title: string, slug: string, message: string | undefined) => void;

export function createNotesMcpServer(agentDir: string, onShareNote?: OnShareNoteCallback): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: "notes",
    tools: [
      tool(
        "save_note",
        "Create or overwrite a note. Use for new notes or when you want to replace existing content entirely.",
        {
          title: z.string().describe("Note title"),
          content: z.string().describe("Markdown content"),
        },
        async (args) => {
          if (!args.title.trim()) {
            return {
              content: [{ type: "text" as const, text: "Title cannot be empty." }],
              isError: true,
            };
          }
          const slug = slugify(args.title);
          if (!slug) {
            return {
              content: [{ type: "text" as const, text: "Title must contain at least one alphanumeric character." }],
              isError: true,
            };
          }
          writeNote(agentDir, slug, args.content);
          return {
            content: [{ type: "text" as const, text: `Saved note: ${args.title}` }],
          };
        },
      ),

      tool(
        "list_notes",
        "List all your notes.",
        {},
        async () => {
          const notes = listNotes(agentDir);
          if (notes.length === 0) {
            return {
              content: [{ type: "text" as const, text: "No notes yet." }],
            };
          }
          const list = notes.map((n) => n.title).join("\n");
          return {
            content: [{ type: "text" as const, text: list }],
          };
        },
      ),

      tool(
        "read_note",
        "Read the content of a note by title.",
        {
          title: z.string().describe("Note title"),
        },
        async (args) => {
          const slug = slugify(args.title);
          const content = readNote(agentDir, slug);
          if (content === null) {
            return {
              content: [{ type: "text" as const, text: `Note not found: ${args.title}` }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text" as const, text: content }],
          };
        },
      ),

      tool(
        "update_note",
        "Update an existing note. Errors if the note doesn't exist — use save_note for new notes.",
        {
          title: z.string().describe("Note title"),
          content: z.string().describe("New markdown content"),
        },
        async (args) => {
          const slug = slugify(args.title);
          if (!noteExists(agentDir, slug)) {
            return {
              content: [{ type: "text" as const, text: `Note not found: ${args.title}` }],
              isError: true,
            };
          }
          writeNote(agentDir, slug, args.content);
          return {
            content: [{ type: "text" as const, text: `Updated note: ${args.title}` }],
          };
        },
      ),

      tool(
        "delete_note",
        "Delete a note by title.",
        {
          title: z.string().describe("Note title"),
        },
        async (args) => {
          const slug = slugify(args.title);
          if (!deleteNote(agentDir, slug)) {
            return {
              content: [{ type: "text" as const, text: `Note not found: ${args.title}` }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text" as const, text: `Deleted note: ${args.title}` }],
          };
        },
      ),

      tool(
        "share_note",
        "Share a note with the user — sends them a link to open and edit it. Use after saving or updating a note you want them to review.",
        {
          title: z.string().describe("Note title"),
          message: z.string().optional().describe("Optional message to accompany the note link"),
        },
        async (args) => {
          const slug = slugify(args.title);
          if (!noteExists(agentDir, slug)) {
            return {
              content: [{ type: "text" as const, text: `Note not found: ${args.title}` }],
              isError: true,
            };
          }
          if (onShareNote) {
            onShareNote(args.title, slug, args.message);
          }
          return {
            content: [{ type: "text" as const, text: `Shared note: ${args.title}` }],
          };
        },
      ),
    ],
  });
}
