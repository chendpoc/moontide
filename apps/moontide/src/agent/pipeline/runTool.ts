import type { ContentBlock } from "@moontide/llm/protocol";

import { maybeSpillToolResult } from "@moontide/session/stores";
import { summarizeToolResultContent } from "@moontide/session";
import { getWorkdir, spillOptions } from "../../config.js";
import { createToolContext, type LoopContext } from "../deps.js";
import { executeTool } from "../../tools/index.js";
import { isAlwaysAllowEnabled } from "../../tools/always-allow-mode.js";
import { effectiveDecision } from "@moontide/tools";
import { checkPermission } from "./permission/index.js";
import {
  buildModelToolResult,
  freezeToolUseContext,
  freezeToolUseRecord,
  outcomeFromToolOutput,
} from "./tool-result.js";
import { toFailureOutcome } from "@moontide/shared/errors/outcome.js";
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
  const { runtime } = loopCtx;
  try {
    const rawDecision = checkPermission(ctx.toolName, ctx.toolInput, runtime);
    const policy = isAlwaysAllowEnabled() ? "always" : "ask";
    const decision = effectiveDecision(rawDecision, policy);
    if (decision === "deny") {
      return { status: "denied", reason: `Permission denied: ${ctx.toolName}` };
    }

    const blocked = await runtime.hooks.dispatch("beforeToolUse", freezeToolUseContext(ctx));
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
    return toFailureOutcome(err);
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
  const { modelAppends } = await loopCtx.runtime.hooks.dispatch(
    "toolUse",
    freezeToolUseRecord(record),
  );
  const rawContent = buildModelToolResult(outcome, modelAppends);

  let content = rawContent;
  if (loopCtx.stores) {
    const spilled = await maybeSpillToolResult(
      loopCtx.session.sessionId,
      block.id,
      rawContent,
      loopCtx.stores.artifacts,
      getWorkdir(),
      spillOptions(),
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
