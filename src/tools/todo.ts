import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "./types.js";
import { cloneTodos, formatTodoList, todoSummary } from "../todos.js";

const TodoItemSchema = z.object({
  text: z.string().trim().min(1),
  status: z.enum(["pending", "in_progress", "done"]),
});

const readSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const writeSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      description:
        "Full replacement todo list for the current session, in display order.",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "done"],
          },
        },
        required: ["text", "status"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

const TodoWriteArgs = z.object({
  items: z.array(TodoItemSchema),
});

export const todoReadTool: Tool = {
  name: "todo_read",
  description:
    "Read the current session todo list. Use this to inspect active tasks before updating them.",
  inputSchema: readSchema,
  riskLevel: "low",
  concurrency: "concurrent",

  async execute(_rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
    const items = ctx.getTodos ? ctx.getTodos() : [];
    return {
      isError: false,
      content: formatTodoList(items),
    };
  },
};

export const todoWriteTool: Tool = {
  name: "todo_write",
  description:
    "Replace the current session todo list with a full new list. Use for planning and progress tracking on complex tasks.",
  inputSchema: writeSchema,
  riskLevel: "low",
  concurrency: "exclusive",

  async execute(rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
    const parsed = TodoWriteArgs.safeParse(rawInput);
    if (!parsed.success) {
      return {
        isError: true,
        content:
          "Invalid arguments for todo_write: " +
          parsed.error.issues.map((i) => i.message).join("; ") +
          ". Expected { items: Array<{ text: string, status: pending|in_progress|done }> }.",
      };
    }
    if (!ctx.setTodos) {
      return {
        isError: true,
        content: "todo_write is unavailable in this context.",
      };
    }
    const items = cloneTodos(parsed.data.items);
    ctx.setTodos(items);
    return {
      isError: false,
      content: todoSummary(items),
      details: formatTodoList(items),
    };
  },
};
