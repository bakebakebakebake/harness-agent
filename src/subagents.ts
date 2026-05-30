import type { Message } from "./model/types.js";

/** Request payload for an isolated subagent run. */
export interface SubagentRequest {
  task: string;
  instructions?: string;
  toolWhitelist?: string[];
  maxTurns?: number;
  signal?: AbortSignal;
}

/** Result returned by a completed subagent run. */
export interface SubagentResult {
  summary: string;
  turns: number;
  history: Message[];
}

/** Callable hook that runs a nested agent loop and returns a summary. */
export type SubagentRunner = (request: SubagentRequest) => Promise<SubagentResult>;
