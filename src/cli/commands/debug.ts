import {
  describeDebugMode,
  getDebugLevel,
  parseDebugLevelArg,
  setDebugOverride,
} from "../../context-inspect/debug-mode.js";
import { reply } from "./io.js";
import type { ReplCommandResult } from "./types.js";

export function handleDebugCommand(arg: string | undefined): ReplCommandResult {
  const parsed = parseDebugLevelArg(arg);
  if (parsed === null) {
    reply("usage: /debug on|terminal|file|off|status");
    reply("  on|terminal — full compose/llm/tool dumps to stderr (default tier)");
    reply("  file        — terminal + .ocula/debug/<runId>.jsonl");
    return "handled";
  }
  if (parsed === "status") {
    reply(describeDebugMode());
    const level = getDebugLevel();
    if (level === "off") {
      reply("enable with /debug on or OCULA_DEBUG=1|terminal|file");
    }
    return "handled";
  }
  setDebugOverride(parsed);
  reply(describeDebugMode());
  return "handled";
}
