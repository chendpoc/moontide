import type { ModelProfile } from "@moontide/llm/models";
import type { LLMRequest, Message, ToolSchema } from "@moontide/llm/protocol";
import type { SessionMessage } from "@moontide/session";
import type { SpillOptions } from "@moontide/session/stores";
import type {
  ArtifactStore,
  CheckpointStore,
  CompactionStore,
} from "@moontide/session/stores";
import type { BudgetConfig } from "./ports/budget-config.js";
import type { InstructionState } from "./system/types.js";
import type { CompactionPolicy } from "./compaction/policy.js";
import type { BudgetTierUsage } from "./budget/types.js";

/** Target compose input. See docs/spec/context-composer.md §10.1. */
export interface ComposeContextInput {
  sessionId: string;
  turn: number;
  messages: readonly SessionMessage[];
  instructionState: InstructionState;
  artifactStore: ArtifactStore;
  compactionStore: CompactionStore;
  checkpointStore: CheckpointStore;
  toolDefinitions: ToolSchema[];
  modelProfile: ModelProfile;
  compactionPolicy: CompactionPolicy;
  resumeFromCheckpointId?: string;
  /** Active summary compaction (overridden by checkpoint on resume). */
  activeCompactionSaveId?: string;
  /** Pre-resolved Working Set snapshot for Deep Task Mode (Phase B compose inject). */
  workingSetSnapshot?: string;
  /** Deep Task Mode protocol block (goal + workMemId). */
  deepTask?: {
    goal: string;
    workMemId: string;
    thinkingBump?: boolean;
    synthesizeSkipped?: boolean;
  };
  /** Workspace root for artifact spill (injected by product layer). */
  workdir: string;
  /** Artifact spill thresholds (injected by product layer). */
  spillOptions: SpillOptions;
  /** Context budget tier caps (injected by product layer). */
  budget: BudgetConfig;
}

export interface ComposedLLMRequest {
  system: string;
  messages: Message[];
  tools: ToolSchema[];
}

export interface ManifestAlert {
  code: string;
  message: string;
}

/** v1 manifest — expanded in C1b. */
export interface ContextManifest {
  turn: number;
  toolDefinitionNames: string[];
  sessionId?: string;
  modelProfile?: ModelProfile;
  estimatedInputTokens?: number;
  exactInputTokens?: number;
  sourceItemIds?: string[];
  checkpointExcludedItemIds?: string[];
  compiledMessageItemIds?: string[];
  compactionExcludedItemIds?: string[];
  activeCompactionSaveId?: string;
  resumeCheckpointId?: string;
  alerts?: ManifestAlert[];
  /** Context Budget Tier breakdown (L1–L4; L5 when enabled). */
  budgetTiers?: BudgetTierUsage[];
  /** Deep Task Mode metadata when active at compose time. */
  deepTask?: {
    active: true;
    workMemId: string;
    goal: string;
    thinkingBump?: boolean;
    synthesizeSkipped?: boolean;
  };
}

export interface ComposedContext {
  request: ComposedLLMRequest | LLMRequest;
  manifest: ContextManifest;
}
