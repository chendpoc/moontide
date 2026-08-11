import type { ComposedLLMRequest } from "@moontide/context-composer";

/** Shared compose snapshot for StreamFn within a single run turn. */
export interface ComposeState {
  turn: number;
  request?: ComposedLLMRequest;
}

export function createComposeState(): ComposeState {
  return { turn: 0 };
}

export function setComposeRequest(state: ComposeState, turn: number, request: ComposedLLMRequest): void {
  state.turn = turn;
  state.request = request;
}
