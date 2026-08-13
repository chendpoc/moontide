import { debugLogPath, ensureDebugLogFile, getWorkdir } from "@moontide/agent";
import { DATA_DIR } from "@moontide/shared/constants/storage.js";
import { APP_ENV, envVarName } from "@moontide/shared/constants/env.js";
import {
  describeDebugMode,
  getDebugLevel,
  parseDebugLevelArg,
  setDebugOverride,
} from "@moontide/agent";
import { getRunId } from "../../log/index.js";
import { formatDebugWatchHintLines } from "../debug-watch.js";
import { reply } from "./io.js";
import type { ParsedReplCommand, ReplCommandContext, ReplCommandResult } from "./types.js";

export function formatDebugStatusHint(ctx: ReplCommandContext): string[] {
  const agentSession = ctx.getAgentSession();
  const sessionId = agentSession?.session.sessionId;
  const runId = getRunId();
  const workdir = getWorkdir();
  const logPath = sessionId
    ? debugLogPath(workdir, sessionId)
    : debugLogPath(workdir, "<session-id>");
  const lines: string[] = [];
  if (sessionId) {
    lines.push(`session ${sessionId} · run ${runId}`);
  } else {
    lines.push(`run ${runId}`);
  }
  lines.push(`log file: ${logPath}`);
  if (getDebugLevel() !== "off") {
    lines.push(...formatDebugWatchHintLines(logPath, workdir));
  }
  return lines;
}

export function handleDebugCommand(
  parsed: Pick<ParsedReplCommand, "arg" | "arg2">,
  ctx: ReplCommandContext,
): ReplCommandResult {
  const levelArg = parseDebugLevelArg(parsed.arg);
  if (levelArg === null) {
    reply("usage: /debug on|file|off|status");
    reply(`  on|file — append compose/llm/tool records to ${DATA_DIR}/debug/<sessionId>.jsonl`);
    reply("  status  — log path + tail | jq watch lines (requires jq)");
    reply("  off     — disable debug file");
    return "handled";
  }
  if (levelArg === "status") {
    reply(describeDebugMode());
    const agentSession = ctx.getAgentSession();
    if (agentSession && getDebugLevel() !== "off") {
      ensureDebugLogFile(getWorkdir());
    }
    for (const line of formatDebugStatusHint(ctx)) {
      reply(line);
    }
    const level = getDebugLevel();
    if (level === "off") {
      reply(`enable with /debug on or ${envVarName(APP_ENV.DEBUG)}=file (dev default: file when ${envVarName(APP_ENV.ENV)}=dev)`);
    }
    return "handled";
  }
  setDebugOverride(levelArg);
  if (levelArg === "file") {
    ensureDebugLogFile(getWorkdir());
  }
  reply(describeDebugMode());
  return "handled";
}
