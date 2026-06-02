export function classifyRuntimeError(err: Error): string {
  const text = err.message.toLowerCase();
  if (/(api key|credential|config|profile|unauthoriz|forbidden|401|403)/.test(text)) {
    return `configuration problem (${err.message})`;
  }
  if (/(timed out|timeout|network|fetch failed|econn|socket|503|502|429)/.test(text)) {
    return `temporary network/provider problem (${err.message})`;
  }
  if (/(enoent|not found|spawn|permission denied)/.test(text)) {
    return `external tool problem (${err.message})`;
  }
  return `unexpected internal error (${err.message})`;
}
