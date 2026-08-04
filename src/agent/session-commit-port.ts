import { FileSessionItemWriter } from "../session/io/index.js";
import type { SessionItemCommitPort } from "../session/ports.js";
import type { SessionItem } from "../session/types.js";
import { getAgentRuntime, type AgentRuntime } from "./runtime/index.js";

export function createSessionCommitPort(
  workdir: string,
  runtime: AgentRuntime = getAgentRuntime(),
): SessionItemCommitPort {
  const writer = new FileSessionItemWriter(workdir);
  return {
    async onItemCommitted(item: SessionItem) {
      await writer.append(item.sessionId, item);
      await runtime.hooks.dispatch("sessionItem", { item });
    },
    async replaceAll(sessionId: string, items: SessionItem[]) {
      await writer.replaceAll(sessionId, items);
    },
  };
}
