import type { Skill } from "./ext/skills.js";
import type { ContentBlock } from "./model/types.js";

export type PendingAttachmentKind = "skill" | "mcp" | "image";

export type PendingImageBlock = Extract<ContentBlock, { type: "image" }>;

export interface PendingAttachment {
  kind: PendingAttachmentKind;
  label: string;
  context?: string;
  image?: PendingImageBlock;
}

export interface PendingAttachmentGroups {
  skills: string[];
  mcps: string[];
  images: string[];
}

interface PendingContextState {
  pendingContext: string[];
  pendingAttachments: PendingAttachment[];
}

export function skillAttachment(skill: Skill): PendingAttachment {
  return {
    kind: "skill",
    label: skill.name,
    context: `# Skill: ${skill.name}\n\n${skill.body}`,
  };
}

export function mcpAttachment(name: string, description?: string): PendingAttachment {
  const summary = description?.trim()
    ? `Use the MCP server "${name}" for this next message when its tools are relevant.\n\nServer notes: ${description.trim()}`
    : `Use the MCP server "${name}" for this next message when its tools are relevant.`;
  return {
    kind: "mcp",
    label: name,
    context: `# MCP: ${name}\n\n${summary}`,
  };
}

export function imageAttachment(image: PendingImageBlock): PendingAttachment {
  return {
    kind: "image",
    label: image.path.split(/[\\/]/).pop() ?? image.path,
    image,
  };
}

export function pushPendingAttachment(
  state: PendingContextState,
  attachment: PendingAttachment,
): void {
  const existing = state.pendingAttachments.findIndex(
    (item) => item.kind === attachment.kind && item.label === attachment.label,
  );
  if (existing >= 0) {
    state.pendingAttachments.splice(existing, 1);
  }
  state.pendingAttachments.push(attachment);

  if (attachment.context) {
    const blockIdx = state.pendingContext.findIndex((block) => block === attachment.context);
    if (blockIdx >= 0) state.pendingContext.splice(blockIdx, 1);
    state.pendingContext.push(attachment.context);
  }
}

export function removePendingAttachment(
  state: PendingContextState,
  kind: PendingAttachmentKind,
  label: string,
): boolean {
  const idx = state.pendingAttachments.findIndex(
    (item) => item.kind === kind && item.label.toLowerCase() === label.trim().toLowerCase(),
  );
  if (idx < 0) return false;
  const removed = state.pendingAttachments[idx]!;
  state.pendingAttachments.splice(idx, 1);
  if (removed.context) {
    const blockIdx = state.pendingContext.findIndex((block) => block === removed.context);
    if (blockIdx >= 0) state.pendingContext.splice(blockIdx, 1);
  }
  return true;
}

export function popPendingAttachment(state: PendingContextState): PendingAttachment | null {
  const removed = state.pendingAttachments.pop() ?? null;
  if (!removed) return null;
  if (removed.context) {
    const blockIdx = state.pendingContext.findIndex((block) => block === removed.context);
    if (blockIdx >= 0) state.pendingContext.splice(blockIdx, 1);
  }
  return removed;
}

export function clearPendingAttachments(state: PendingContextState): void {
  state.pendingAttachments = [];
  state.pendingContext = [];
}

export function clearPendingAttachmentsByKind(
  state: PendingContextState,
  kind: PendingAttachmentKind,
): void {
  state.pendingAttachments = state.pendingAttachments.filter((item) => item.kind !== kind);
  state.pendingContext = state.pendingAttachments
    .map((item) => item.context)
    .filter((item): item is string => typeof item === "string" && item.length > 0);
}

export function attachmentBadges(
  attachments: readonly PendingAttachment[],
): string[] {
  const { skills, mcps, images } = groupPendingAttachments(attachments);
  const badges: string[] = [];
  if (images.length > 0) badges.push(`images: ${images.join(", ")}`);
  if (mcps.length > 0) badges.push(`mcp: ${mcps.join(", ")}`);
  if (skills.length > 0) badges.push(`skills: ${skills.join(", ")}`);
  return badges;
}

export function groupPendingAttachments(
  attachments: readonly PendingAttachment[],
): PendingAttachmentGroups {
  return {
    images: attachments
      .filter((item) => item.kind === "image")
      .map((item) => item.label),
    skills: attachments
      .filter((item) => item.kind === "skill")
      .map((item) => item.label),
    mcps: attachments
      .filter((item) => item.kind === "mcp")
      .map((item) => item.label),
  };
}

export function pendingUserContent(
  text: string,
  attachments: readonly PendingAttachment[],
): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  if (text.length > 0) blocks.push({ type: "text", text });
  for (const attachment of attachments) {
    if (attachment.kind === "image" && attachment.image) {
      blocks.push(attachment.image);
    }
  }
  return blocks;
}
