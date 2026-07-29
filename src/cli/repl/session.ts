import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { compactAutoDefault } from "../../config.js";

let replMessages: MessageParam[] | null = null;
let compactAutoOverride: boolean | null = null;

export function hasReplSession(): boolean {
  return replMessages !== null;
}

export function getReplMessages(): MessageParam[] | null {
  return replMessages;
}

export function startReplSession(): MessageParam[] {
  replMessages = [];
  return replMessages;
}

export function resetReplSession(): void {
  replMessages = null;
}

export function isCompactAutoEnabled(): boolean {
  if (compactAutoOverride !== null) {
    return compactAutoOverride;
  }
  return compactAutoDefault();
}

export function setCompactAutoOverride(value: boolean | null): void {
  compactAutoOverride = value;
}
