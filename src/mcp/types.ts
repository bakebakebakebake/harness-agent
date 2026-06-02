/** A tool discovered from an MCP server before it is materialized locally. */
export interface McpToolCandidate {
  server: string;
  name: string;
  registeredName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpSearchOptions {
  server?: string;
  limit?: number;
}

export interface McpCallResult {
  content: string;
  isError: boolean;
  details?: string;
}

export interface McpServerStatus {
  name: string;
  scope: "user" | "project";
  command: string;
  args: string[];
  description?: string;
  configured: boolean;
  connected: boolean;
  loadedTools: number;
}

/** Minimal runtime surface the `mcp_search` tool needs. */
export interface McpRuntime {
  search(query: string, opts?: McpSearchOptions): Promise<McpToolCandidate[]>;
  callTool(
    candidate: McpToolCandidate,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<McpCallResult>;
  status(): McpServerStatus[];
}
