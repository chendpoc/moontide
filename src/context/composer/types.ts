import type { ModelProfile } from "../../llm/models/types.js";
import type { LLMRequest, Message, ToolSchema } from "../../llm/protocol/types.js";
import type { SessionMessage } from "../../session/types.js";
import type {
  ArtifactStore,
  CheckpointStore,
  CompactionStore,
} from "../stores/index.js";
import type { InstructionState } from "./system/types.js";
import type { CompactionPolicy } from "./compaction/policy.js";

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
}

export interface ComposedLLMRequest {
  system: string;
  messages: Message[];
  tools: ToolSchema[];
}

export interface ContextAlert {
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
  alerts?: ContextAlert[];
}

export interface ComposedContext {
  request: ComposedLLMRequest | LLMRequest;
  manifest: ContextManifest;
}
