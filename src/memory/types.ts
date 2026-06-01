export type MemoryScope = "project" | "user";
export type MemoryKind =
  | "preference"
  | "decision"
  | "constraint"
  | "fact"
  | "workflow"
  | "pattern";
export type MemoryTier = "core" | "archive";
export type MemoryStatus = "active" | "superseded" | "expired" | "forgotten";
export type MemorySourceKind = "manual" | "extracted" | "inferred";

export interface RawTurn {
  sessionId: string;
  turnIndex: number;
  role: "user" | "assistant" | "tool";
  text: string;
  createdAt: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
}

export interface MemoryCard {
  id: string;
  title: string;
  scope: MemoryScope;
  kind: MemoryKind;
  tier: MemoryTier;
  summary: string;
  body: string;
  tags: string[];
  entities: string[];
  importance: number;
  trust: number;
  status: MemoryStatus;
  supersedes: string[];
  validFrom?: string;
  validUntil?: string;
  sourceSessionId?: string;
  sourceTurnRefs: string[];
  sourceKind: MemorySourceKind;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string;
  accessCount: number;
}

export interface MemoryDraft {
  title: string;
  scope: MemoryScope;
  kind: MemoryKind;
  summary: string;
  body?: string;
  tags?: string[];
  entities?: string[];
  tier?: MemoryTier;
  trust?: number;
  importance?: number;
  sourceKind?: MemorySourceKind;
}

export interface MemorySearchHit {
  card: MemoryCard;
  score: number;
  reason: string;
}

export interface MemoryContextPacket {
  intent: "procedural" | "preference" | "factual" | "historical" | "constraint_aware";
  summaryLines: string[];
  coreDigest: string[];
  cards: MemoryCard[];
  skills: Array<{
    name: string;
    description: string;
    scope: "user" | "project";
  }>;
  tokenEstimate: number;
  diagnostics?: {
    preferredScope: MemoryScope;
    candidates: Array<{
      id: string;
      title: string;
      scope: MemoryScope;
      kind: MemoryKind;
      status: MemoryStatus;
      score: number;
      quality: number;
      freshness: number;
      source: string;
      reasons: string[];
    }>;
    relationships: Array<{
      id: string;
      title: string;
      relation: "supersedes" | "superseded_by";
      targetId: string;
      targetTitle: string;
      targetStatus: MemoryStatus;
    }>;
  };
}
