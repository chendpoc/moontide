import { reply } from "./io.js";
import type { ParsedReplCommand, ReplCommandContext, ReplCommandResult } from "./types.js";

export async function handleCheckpointCommand(
  parsed: ParsedReplCommand,
  ctx: ReplCommandContext,
): Promise<ReplCommandResult> {
  const agentSession = ctx.getAgentSession();
  if (!agentSession) {
    reply("nothing to checkpoint — send a prompt first");
    return "handled";
  }

  const messages = agentSession.session.getMessages();
  if (messages.length === 0) {
    reply("nothing to checkpoint — send a prompt first");
    return "handled";
  }

  if (parsed.arg === "list") {
    const checkpoints = await agentSession.stores.checkpoints.list(
      agentSession.session.sessionId,
    );
    if (checkpoints.length === 0) {
      reply("no checkpoints yet");
      return "handled";
    }
    for (const checkpoint of checkpoints) {
      const label = checkpoint.label ? ` · ${checkpoint.label}` : "";
      reply(
        `${checkpoint.id} · turn ${checkpoint.createdAtTurn} · last ${checkpoint.lastItemId}${label}`,
      );
    }
    return "handled";
  }

  const label = parsed.parts.slice(1).join(" ") || undefined;
  const turn = messages.at(-1)?.turn ?? 1;
  const checkpoint = await agentSession.createCheckpoint(turn, label);
  reply(
    `checkpoint ${checkpoint.id} · turn ${checkpoint.createdAtTurn} · last item ${checkpoint.lastItemId}`,
  );
  return "handled";
}
