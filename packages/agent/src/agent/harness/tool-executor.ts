import type { ToolExecutor } from "@moontide/run-protocol";
import type { LoopContext } from "../deps.js";
import { runToolUse } from "../pipeline/runTool.js";
import { buildModelToolResult } from "../pipeline/tool-result.js";

export interface MoonTideToolExecutorOptions {
  loopCtx: LoopContext;
  getTurn: () => number;
}

export function createMoonTideToolExecutor(options: MoonTideToolExecutorOptions): ToolExecutor {
  const { loopCtx, getTurn } = options;

  return {
    async execute(toolCallId, toolName, args) {
      const result = await runToolUse(
        {
          type: "tool_use",
          id: toolCallId,
          name: toolName,
          input: args as Record<string, unknown>,
        },
        getTurn(),
        loopCtx,
      );
      const isError = result.content.startsWith("Permission denied")
        || result.content.startsWith("Error:");
      return { content: result.content, isError };
    },
  };
}

/** Map blocked tool to model-visible error content (RunConfig beforeToolCall path). */
export function blockedToolResult(reason: string): { content: string; isError: true } {
  return { content: buildModelToolResult({ status: "denied", reason }, []), isError: true };
}
