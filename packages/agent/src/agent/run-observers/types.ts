import type { ComposedContext } from "@moontide/context-composer";
import type { EventDraft } from "../../log/types.js";
import type { SessionItem } from "@moontide/session";
import type {
	LLMCallRecord,
	ToolUseContext,
	ToolUseRecord,
} from "../pipeline/types.js";
import type { ObserverErrorPolicy, ObserverPhase } from "./phases.js";

export type { ToolUseContext };

export type ObserverDecideResult = { block: true; reason: string };

export type StepObserveResult =
	| void
	| EventDraft
	| EventDraft[]
	| {
			events?: void | EventDraft | EventDraft[];
			modelAppend?: string;
	  };

export interface ObserverContextMap {
	sessionItem: { item: SessionItem };
	composeComplete: { composed: ComposedContext };
	runStart: { userPrompt: string };
	runEnd: { reply: string; turn: number };
	runFinalize: Record<string, never>;
	runError: { error: unknown };
	turnStart: { turn: number };
	turnEnd: { turn: number };
	beforeToolUse: ToolUseContext;
	toolUse: ToolUseRecord;
	llmCall: LLMCallRecord;
}

export type ObserverHandlerResult = StepObserveResult | ObserverDecideResult;

export type ObserverHandler<P extends ObserverPhase> = (
	ctx: ObserverContextMap[P],
) => ObserverHandlerResult | Promise<ObserverHandlerResult>;

export interface ObserverDispatchResultMap {
	sessionItem: void;
	composeComplete: void;
	runStart: void;
	runEnd: void;
	runFinalize: void;
	runError: void;
	turnStart: void;
	turnEnd: void;
	beforeToolUse: ObserverDecideResult | undefined;
	toolUse: { modelAppends: string[] };
	llmCall: void;
}

export interface ObserverFailureRecord {
	phase: ObserverPhase;
	name: string;
	message: string;
	stack?: string;
	turn?: number;
	toolName?: string;
	toolUseId?: string;
}

export interface ObserverRegistration<P extends ObserverPhase = ObserverPhase> {
	phase: P;
	name: string;
	handler: ObserverHandler<P>;
	order: number;
	errorPolicy?: ObserverErrorPolicy;
}
