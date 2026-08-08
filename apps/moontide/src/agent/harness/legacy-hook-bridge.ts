import type { RunEvent } from "@moontide/agent-common";
import type { RunEventListener } from "@moontide/agent-core";
import type { AgentRuntime } from "../runtime/index.js";

export interface LegacyHookBridgeOptions {
  runtime: AgentRuntime;
}

export interface LegacyHookBridge {
  listener: RunEventListener;
  getResult: () => { reply: string; turn: number } | undefined;
}

/** Map RunEvent turn phases to legacy HookDispatcher until M7 clean break. */
export function createLegacyHookBridge(options: LegacyHookBridgeOptions): LegacyHookBridge {
  const { runtime } = options;
  let turn = 0;
  let result: { reply: string; turn: number } | undefined;

  const listener: RunEventListener = (event: RunEvent) => {
    void _dispatch(event);
  };

  async function _dispatch(event: RunEvent): Promise<void> {
    if (event.type === "turn_start") {
      turn += 1;
      await runtime.hooks.dispatch("turnStart", { turn });
      return;
    }
    if (event.type === "turn_end") {
      await runtime.hooks.dispatch("turnEnd", { turn });
      return;
    }
    if (event.type === "run_end" && event.outcome.kind === "success") {
      result = { reply: _extractReply(event), turn };
    }
  }

  return {
    listener,
    getResult: () => result,
  };
}

function _extractReply(event: Extract<RunEvent, { type: "run_end" }>): string {
  const messages = event.outcome.messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") {
      return message.content
        .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
        .map((block) => block.text)
        .join("");
    }
  }
  return "";
}
