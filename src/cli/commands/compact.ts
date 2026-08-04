import {
  defaultCompactSystem,
  previewCompact,
} from "../../context/compact.js";
import { composeContext } from "../../context/composer/compose.js";
import { resolveModelProfile } from "../../llm/models/resolve.js";
import { getToolDefinitions } from "../../tools/index.js";
import { reply, formatCompactReport } from "./io.js";
import type { ParsedReplCommand, ReplCommandContext, ReplCommandResult } from "./types.js";

async function buildComposePreview(agentSession: NonNullable<ReturnType<ReplCommandContext["getAgentSession"]>>) {
  const session = agentSession.session;
  return composeContext({
    sessionId: session.sessionId,
    turn: 0,
    messages: session.getMessages(),
    instructionState: { basePrompt: defaultCompactSystem(), epoch: 1 },
    artifactStore: agentSession.stores.artifacts,
    compactionStore: agentSession.stores.compaction,
    checkpointStore: agentSession.stores.checkpoints,
    toolDefinitions: getToolDefinitions(agentSession.runtime),
    modelProfile: resolveModelProfile(),
    compactionPolicy: { ...agentSession.getCompactionPolicy(), autoEnabled: false },
    activeCompactionSaveId: agentSession.getActiveCompactionSaveId(),
    resumeFromCheckpointId: agentSession.getResumeCheckpointId(),
  });
}

export async function handleCompactCommand(
  parsed: ParsedReplCommand,
  ctx: ReplCommandContext,
): Promise<ReplCommandResult> {
  const agentSession = ctx.getAgentSession();
  if (!agentSession) {
    reply("nothing to compact — send a prompt first");
    return "handled";
  }

  const session = agentSession.session;
  if (session.getMessages().length === 0) {
    reply("nothing to compact — send a prompt first");
    return "handled";
  }

  const { arg } = parsed;
  const turn = session.getMessages().at(-1)?.turn ?? 1;

  if (arg === "auto") {
    const mode = parsed.parts[2]?.toLowerCase();
    if (mode === "on") {
      agentSession.setCompactAuto(true);
      reply("compact auto: on");
      return "handled";
    }
    if (mode === "off") {
      agentSession.setCompactAuto(false);
      reply("compact auto: off");
      return "handled";
    }
    reply(`compact auto: ${agentSession.isCompactAutoEnabled() ? "on" : "off"}`);
    return "handled";
  }

  if (arg === "preview") {
    const composed = await buildComposePreview(agentSession);
    const preview = previewCompact(
      composed.request.messages,
      composed.request.system,
      composed.request.tools,
      agentSession.getCompactionPolicy().keepTurns,
    );
    reply(
      formatCompactReport(
        "preview",
        preview.beforeTokens,
        preview.afterTokens,
        `${preview.truncatedToolResults} tool results would shrink · keep from index ${preview.keepFromIndex}`,
      ),
    );
    return "handled";
  }

  if (arg === "summary") {
    try {
      const result = await agentSession.runSummaryCompaction(turn);
      reply(
        formatCompactReport(
          "summary",
          result.beforeTokens,
          result.afterTokens,
          `CompactionSave ${result.save.id} · covers ${result.save.coversItemIds.length} items · keep from index ${result.keepFromIndex}`,
        ),
      );
    } catch (err) {
      reply(err instanceof Error ? err.message : String(err));
    }
    return "handled";
  }

  if (!arg || arg === "prune") {
    const preview = await agentSession.runPruneCompaction(turn);
    if (!preview.wouldChange) {
      reply("nothing to prune — context already within keep window");
      return "handled";
    }
    reply(
      formatCompactReport(
        "prune",
        preview.beforeTokens,
        preview.afterTokens,
        `${preview.truncatedToolResults} tool results will shrink on next turn · keep from index ${preview.keepFromIndex}`,
      ),
    );
    return "handled";
  }

  reply("usage: /compact [preview|prune|summary] · /compact auto on|off");
  return "handled";
}
