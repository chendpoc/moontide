import { setReplPhase } from "./collect.js";
import {
  isActivityRepaintEnabled,
  setActivityTickHandler,
  startActivityLine,
  stopActivityLine,
} from "./activity.js";
import {
  invalidateStatusLineCommandCache,
  isStatusStackPinned,
  renderStatusStack,
  renderStatusStackAsync,
  resetStatusStackRender,
} from "./render-stack.js";

setActivityTickHandler(() => {
  if (isStatusStackPinned() && isActivityRepaintEnabled()) {
    renderStatusStack();
  }
});

/** Reset dedupe state (tests). */
export function resetStatusLineRender(): void {
  resetStatusStackRender();
  stopActivityLine();
  setReplPhase("idle");
}

export function renderStatusLine(): void {
  renderStatusStack();
}

export async function renderStatusLineAsync(): Promise<void> {
  await renderStatusStackAsync();
}

export function beginAgentActivity(): void {
  setReplPhase("running");
  invalidateStatusLineCommandCache();
  startActivityLine();
  renderStatusStack();
}

export function endAgentActivity(): void {
  setReplPhase("idle");
  stopActivityLine();
  invalidateStatusLineCommandCache();
  renderStatusStack();
}

export { renderStatusStackAsync };
