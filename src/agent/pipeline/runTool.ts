import type { ContentBlock } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { maybeSpillToolResult } from "../../context/stores/spill-artifact.js";
import { summarizeToolResultContent } from "../../session/content-map.js";
import { hookDispatcher } from "../hooks/index.js";
import { createToolContext, type LoopContext } from "../deps.js";
import { executeTool } from "../../tools/index.js";
import { checkPermission } from "./permission/index.js";
import {
  buildModelToolResult,
  freezeToolUseContext,
  freezeToolUseRecord,
  outcomeFromToolOutput,
} from "./tool-result.js";
import type { ToolUseContext, ToolUseOutcome, ToolUseRecord } from "./types.js";

export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
};

export async function resolveToolUseOutcome(
  ctx: ToolUseContext,
  loopCtx: LoopContext,
): Promise<ToolUseOutcome> {
  try {
    const decision = checkPermission(ctx.toolName, ctx.toolInput);
    if (decision === "deny") {
      return { status: "denied", reason: `Permission denied: ${ctx.toolName}` };
    }

    const blocked = await hookDispatcher.dispatch("beforeToolUse", freezeToolUseContext(ctx));
    if (blocked?.block) {
      return { status: "denied", reason: blocked.reason };
    }

    if (decision === "ask") {
      const approved = await loopCtx.userInteraction.approveTool({
        toolName: ctx.toolName,
        input: ctx.toolInput,
      });
      if (!approved) {
        return { status: "rejected", reason: `Permission denied by user: ${ctx.toolName}` };
      }
    }
    const output = await executeTool(
      ctx.toolName,
      ctx.toolInput,
      createToolContext(loopCtx),
    );
    return outcomeFromToolOutput(output);
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runToolUse(
  block: Extract<ContentBlock, { type: "tool_use" }>,
  turn: number,
  loopCtx: LoopContext,
): Promise<ToolResultBlock> {
  const ctx: ToolUseContext = {
    turn,
    toolName: block.name,
    toolInput: block.input as Record<string, unknown>,
    toolUseId: block.id,
  };
  const outcome = await resolveToolUseOutcome(ctx, loopCtx);
  const record: ToolUseRecord = { ...ctx, outcome };
  const { modelAppends } = await hookDispatcher.dispatch("toolUse", freezeToolUseRecord(record));
  const rawContent = buildModelToolResult(outcome, modelAppends);

  let content = rawContent;
  if (loopCtx.stores) {
    const spilled = await maybeSpillToolResult(
      loopCtx.session.sessionId,
      block.id,
      rawContent,
      loopCtx.stores.artifacts,
    );
    content = spilled.content;
    await loopCtx.session.appendToolOutcome(
      turn,
      block.id,
      spilled.summary,
      spilled.artifactId,
    );
  } else {
    await loopCtx.session.appendToolOutcome(
      turn,
      block.id,
      summarizeToolResultContent(rawContent),
    );
  }

  return {
    type: "tool_result",
    tool_use_id: block.id,
    content,
  };
}

export async function runToolUses(
  turn: number,
  content: ContentBlock[],
  loopCtx: LoopContext,
): Promise<ToolResultBlock[]> {
  const results: ToolResultBlock[] = [];
  for (const block of content) {
    if (block.type !== "tool_use") {
      continue;
    }
    results.push(await runToolUse(block, turn, loopCtx));
  }
  return results;
}
