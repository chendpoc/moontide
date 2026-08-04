import type { ComposedContext } from "../../context/composer/types.js";
import type { EventDraft } from "../../log/types.js";
import type { SessionItem } from "../../session/types.js";
import type { LLMCallRecord, ToolUseContext, ToolUseRecord } from "../pipeline/types.js";
import type { HookErrorPolicy, HookPhase } from "./phases.js";

export type { ToolUseContext };

export type HookDecideResult = { block: true; reason: string };

export type StepObserveResult =
  | void
  | EventDraft
  | EventDraft[]
  | {
      events?: void | EventDraft | EventDraft[];
      modelAppend?: string;
    };

export interface HookContextMap {
  sessionItem: { item: SessionItem };
  composeComplete: { composed: ComposedContext };
  runStart: { userPrompt: string };
  runEnd: { reply: string; turn: number };
  runFinalize: Record<string, never>;
  runError: { error: unknown };
  beforeToolUse: ToolUseContext;
  toolUse: ToolUseRecord;
  llmCall: LLMCallRecord;
}

export type HookHandlerResult = StepObserveResult | HookDecideResult;

export type HookHandler<P extends HookPhase> = (
  ctx: HookContextMap[P],
) => HookHandlerResult | Promise<HookHandlerResult>;

export interface HookDispatchResultMap {
  sessionItem: void;
  composeComplete: void;
  runStart: void;
  runEnd: void;
  runFinalize: void;
  runError: void;
  beforeToolUse: HookDecideResult | undefined;
  toolUse: { modelAppends: string[] };
  llmCall: void;
}

export interface HookFailureRecord {
  phase: HookPhase;
  name: string;
  message: string;
  stack?: string;
  turn?: number;
  toolName?: string;
  toolUseId?: string;
}

export interface HookRegistration<P extends HookPhase = HookPhase> {
  phase: P;
  name: string;
  handler: HookHandler<P>;
  order: number;
  errorPolicy?: HookErrorPolicy;
}
