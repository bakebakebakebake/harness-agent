export type TodoStatus = "pending" | "in_progress" | "done";

export interface TodoItem {
  text: string;
  status: TodoStatus;
}

export function cloneTodos(items: TodoItem[]): TodoItem[] {
  return items.map((item) => ({ ...item }));
}

export function todoStats(items: TodoItem[]): {
  total: number;
  pending: number;
  inProgress: number;
  done: number;
} {
  let pending = 0;
  let inProgress = 0;
  let done = 0;
  for (const item of items) {
    if (item.status === "pending") pending += 1;
    else if (item.status === "in_progress") inProgress += 1;
    else done += 1;
  }
  return { total: items.length, pending, inProgress, done };
}

export function todoSummary(items: TodoItem[]): string {
  const stats = todoStats(items);
  if (stats.total === 0) return "Todo updated: 0 items.";
  const parts: string[] = [];
  if (stats.inProgress > 0) parts.push(`${stats.inProgress} in progress`);
  if (stats.pending > 0) parts.push(`${stats.pending} pending`);
  if (stats.done > 0) parts.push(`${stats.done} done`);
  return `Todo updated: ${stats.total} item${stats.total === 1 ? "" : "s"} (${parts.join(", ")}).`;
}

function statusMark(status: TodoStatus): string {
  switch (status) {
    case "pending":
      return "[ ]";
    case "in_progress":
      return "[~]";
    case "done":
      return "[x]";
  }
}

export function formatTodoList(items: TodoItem[]): string {
  if (items.length === 0) return "No todo items.";
  return items.map((item) => `${statusMark(item.status)} ${item.text}`).join("\n");
}
