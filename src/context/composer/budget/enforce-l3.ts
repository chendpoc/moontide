import { artifactSpillThresholdBytes, getWorkdir } from "../../../config.js";
import type { Message } from "../../../llm/protocol/types.js";
import type { ArtifactStore } from "../../../session/stores/artifact-store.js";
import { maybeSpillToolResult } from "../../../session/stores/spill-artifact.js";
import { byteLengthUtf8 } from "../../../utils/utf8.js";
import { estimateReferenceTokens } from "./estimate.js";
import {
  isCompactToolResultBody,
  isReferenceToolResultBody,
  isSpilledToolResultBody,
} from "./reference-classify.js";
import { COMPACT_PLACEHOLDER_PREFIX } from "./estimate.js";

export interface EnforceL3Input {
  messages: Message[];
  l3Cap: number;
  modelId: string;
  sessionId: string;
  artifactStore: ArtifactStore;
  workdir?: string;
}

export interface EnforceL3Result {
  messages: Message[];
  spilledCount: number;
  compactedCount: number;
  beforeTokens: number;
  afterTokens: number;
}

function toolResultBody(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

const MINIMAL_PLACEHOLDER = "[compact: omitted]";

function isMinimalReference(body: string): boolean {
  return body === MINIMAL_PLACEHOLDER;
}

function shrinkReferenceToMinimal(body: string, toolUseId?: string): string {
  if (isMinimalReference(body)) {
    return body;
  }
  if (isCompactToolResultBody(body)) {
    return MINIMAL_PLACEHOLDER;
  }
  if (isSpilledToolResultBody(body)) {
    const hint = toolUseId ? `, id=${toolUseId}` : "";
    return `${COMPACT_PLACEHOLDER_PREFIX} spilled summary omitted${hint}]`;
  }
  const hint = toolUseId ? `, id=${toolUseId}` : "";
  return `${COMPACT_PLACEHOLDER_PREFIX} ${body.length} chars omitted${hint}]`;
}

async function spillBlockContent(
  sessionId: string,
  toolUseId: string,
  content: string,
  artifactStore: ArtifactStore,
  workdir: string,
): Promise<string> {
  const spilled = await maybeSpillToolResult(sessionId, toolUseId, content, artifactStore, workdir);
  return spilled.content;
}

async function applySpillAt(
  messages: Message[],
  target: { messageIndex: number; blockIndex: number },
  sessionId: string,
  artifactStore: ArtifactStore,
  workdir: string,
): Promise<Message[]> {
  const message = messages[target.messageIndex];
  if (message.role !== "user" || typeof message.content === "string" || !Array.isArray(message.content)) {
    return messages;
  }
  const block = message.content[target.blockIndex];
  if (block.type !== "tool_result") {
    return messages;
  }
  const body = toolResultBody(block.content);
  const spilledContent = await spillBlockContent(
    sessionId,
    block.tool_use_id,
    body,
    artifactStore,
    workdir,
  );
  return messages.map((entry, messageIndex) => {
    if (messageIndex !== target.messageIndex) {
      return entry;
    }
    if (entry.role !== "user" || typeof entry.content === "string" || !Array.isArray(entry.content)) {
      return entry;
    }
    const content = entry.content.map((candidate, blockIndex) => {
      if (blockIndex !== target.blockIndex || candidate.type !== "tool_result") {
        return candidate;
      }
      return { ...candidate, content: spilledContent };
    });
    return { ...entry, content };
  });
}

function applyCompactAt(
  messages: Message[],
  target: { messageIndex: number; blockIndex: number },
): Message[] {
  return messages.map((message, messageIndex) => {
    if (messageIndex !== target.messageIndex) {
      return message;
    }
    if (message.role !== "user" || typeof message.content === "string" || !Array.isArray(message.content)) {
      return message;
    }
    const content = message.content.map((block, blockIndex) => {
      if (blockIndex !== target.blockIndex || block.type !== "tool_result") {
        return block;
      }
      const body = toolResultBody(block.content);
      return {
        ...block,
        content: shrinkReferenceToMinimal(body, block.tool_use_id),
      };
    });
    return { ...message, content };
  });
}

function findInlineSpillCandidate(messages: Message[]): { messageIndex: number; blockIndex: number } | null {
  let best: { messageIndex: number; blockIndex: number; size: number } | null = null;
  const threshold = artifactSpillThresholdBytes();

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    if (message.role !== "user" || typeof message.content === "string" || !Array.isArray(message.content)) {
      continue;
    }
    for (let blockIndex = 0; blockIndex < message.content.length; blockIndex += 1) {
      const block = message.content[blockIndex];
      if (block.type !== "tool_result") {
        continue;
      }
      const body = toolResultBody(block.content);
      if (isReferenceToolResultBody(body)) {
        continue;
      }
      const size = byteLengthUtf8(body);
      if (size <= threshold) {
        continue;
      }
      if (!best || size > best.size) {
        best = { messageIndex, blockIndex, size };
      }
    }
  }

  return best ? { messageIndex: best.messageIndex, blockIndex: best.blockIndex } : null;
}

function findDialogueSpillCandidate(messages: Message[]): { messageIndex: number; blockIndex: number } | null {
  let best: { messageIndex: number; blockIndex: number; size: number } | null = null;

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    if (message.role !== "user" || typeof message.content === "string" || !Array.isArray(message.content)) {
      continue;
    }
    for (let blockIndex = 0; blockIndex < message.content.length; blockIndex += 1) {
      const block = message.content[blockIndex];
      if (block.type !== "tool_result") {
        continue;
      }
      const body = toolResultBody(block.content);
      if (isReferenceToolResultBody(body)) {
        continue;
      }
      const size = body.length;
      if (!best || size > best.size) {
        best = { messageIndex, blockIndex, size };
      }
    }
  }

  return best ? { messageIndex: best.messageIndex, blockIndex: best.blockIndex } : null;
}

function findCompactCandidate(messages: Message[]): { messageIndex: number; blockIndex: number } | null {
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    if (message.role !== "user" || typeof message.content === "string" || !Array.isArray(message.content)) {
      continue;
    }
    for (let blockIndex = 0; blockIndex < message.content.length; blockIndex += 1) {
      const block = message.content[blockIndex];
      if (block.type !== "tool_result") {
        continue;
      }
      const body = toolResultBody(block.content);
      if (isReferenceToolResultBody(body) && !isMinimalReference(body)) {
        return { messageIndex, blockIndex };
      }
    }
  }
  return null;
}

/** Spill oversized inline tool results, then hard-cap L3 reference tier. */
export async function enforceL3ReferenceBudget(input: EnforceL3Input): Promise<EnforceL3Result> {
  const workdir = input.workdir ?? getWorkdir();
  let working = input.messages;
  let spilledCount = 0;
  let compactedCount = 0;
  const beforeTokens = estimateReferenceTokens(working, input.modelId);

  for (let pass = 0; pass < working.length * 4; pass += 1) {
    const inlineTarget = findInlineSpillCandidate(working);
    if (!inlineTarget) {
      break;
    }
    working = await applySpillAt(
      working,
      inlineTarget,
      input.sessionId,
      input.artifactStore,
      workdir,
    );
    spilledCount += 1;
  }

  let afterTokens = estimateReferenceTokens(working, input.modelId);
  const maxIterations = 10_000;

  for (let iteration = 0; iteration < maxIterations && afterTokens > input.l3Cap; iteration += 1) {
    const dialogueTarget = findDialogueSpillCandidate(working);
    if (dialogueTarget) {
      working = await applySpillAt(
        working,
        dialogueTarget,
        input.sessionId,
        input.artifactStore,
        workdir,
      );
      spilledCount += 1;
      afterTokens = estimateReferenceTokens(working, input.modelId);
      continue;
    }

    const compactTarget = findCompactCandidate(working);
    if (!compactTarget) {
      break;
    }
    working = applyCompactAt(working, compactTarget);
    compactedCount += 1;
    afterTokens = estimateReferenceTokens(working, input.modelId);
  }

  return {
    messages: working,
    spilledCount,
    compactedCount,
    beforeTokens,
    afterTokens,
  };
}
