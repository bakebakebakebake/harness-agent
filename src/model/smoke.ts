import type { Config } from "../config.js";
import { createProvider } from "./index.js";
import { fetchModels } from "./models.js";
import type { ModelEvent, Usage } from "./types.js";

export interface ModelSmokeResult {
  provider: string;
  model: string;
  baseURL?: string;
  catalogOk: boolean;
  catalogError?: string;
  catalogCount?: number;
  catalogResolvedURL?: string;
  streamOk: boolean;
  streamError?: string;
  outputText?: string;
  sawReasoning: boolean;
  sawToolUse: boolean;
  stopReason?: string;
  usage?: Usage;
}

export async function smokeTestModel(
  config: Config,
  opts: { model?: string } = {},
): Promise<ModelSmokeResult> {
  const model = opts.model?.trim() || config.model;
  const testConfig: Config = { ...config, model };
  const catalog = await fetchModels({
    provider: testConfig.provider,
    apiKey: testConfig.apiKey,
    ...(testConfig.baseURL ? { baseURL: testConfig.baseURL } : {}),
  });

  const provider = createProvider(testConfig);
  let outputText = "";
  let streamError: string | undefined;
  let sawReasoning = false;
  let sawToolUse = false;
  let stopReason: string | undefined;
  let usage: Usage | undefined;
  const signal = AbortSignal.timeout(20_000);

  try {
    for await (const ev of provider.stream({
      system: "You are a connectivity smoke test. Reply with exactly OK.",
      messages: [{ role: "user", content: [{ type: "text", text: "Reply with exactly OK" }] }],
      tools: [],
      signal,
      ...(testConfig.thinkingDepth ? { thinking: testConfig.thinkingDepth } : {}),
    })) {
      if (ev.type === "text_delta") outputText += ev.text;
      if (ev.type === "reasoning_delta") sawReasoning = true;
      if (ev.type === "tool_use_start") sawToolUse = true;
      if (ev.type === "message_stop") {
        stopReason = ev.stopReason;
        usage = ev.usage;
      }
      if (ev.type === "error") {
        streamError = ev.error.message;
      }
    }
  } catch (err) {
    streamError = (err as Error).message;
  }

  const streamOk = !streamError && outputText.trim().length > 0;
  return {
    provider: testConfig.provider,
    model,
    ...(testConfig.baseURL ? { baseURL: testConfig.baseURL } : {}),
    catalogOk: !catalog.error,
    ...(catalog.error ? { catalogError: catalog.error } : {}),
    catalogCount: catalog.models.length,
    ...(catalog.resolvedURL ? { catalogResolvedURL: catalog.resolvedURL } : {}),
    streamOk,
    ...(streamError ? { streamError } : {}),
    ...(outputText ? { outputText: outputText.trim() } : {}),
    sawReasoning,
    sawToolUse,
    ...(stopReason ? { stopReason } : {}),
    ...(usage ? { usage } : {}),
  };
}
