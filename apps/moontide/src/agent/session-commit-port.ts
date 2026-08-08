import { FileSessionItemWriter } from "@moontide/session";
import type { SessionItemCommitPort } from "@moontide/session";
import type { SessionItem } from "@moontide/session";
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
