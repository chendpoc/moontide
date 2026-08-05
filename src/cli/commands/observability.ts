import { APP_ENV, envVarName } from "../../constants/env.js";
import {
  describeObservabilityModes,
  isThinkingEnabled,
  isVerboseEnabled,
  setThinkingOverride,
  setVerboseOverride,
} from "../../log/modes.js";
import { reply } from "./io.js";
import type { ReplCommandResult } from "./types.js";

function parseToggle(arg: string | undefined): boolean | null | "status" {
  if (!arg || arg === "status") {
    return "status";
  }
  if (arg === "on" || arg === "1" || arg === "true") {
    return true;
  }
  if (arg === "off" || arg === "0" || arg === "false") {
    return false;
  }
  return null;
}

export function handleThinkingCommand(arg: string | undefined): ReplCommandResult {
  const toggle = parseToggle(arg);
  if (toggle === null) {
    reply("usage: /thinking on|off|status");
    return "handled";
  }
  if (toggle === "status") {
    reply(describeObservabilityModes());
    reply(
      isThinkingEnabled()
        ? "shows trace call chain: thinking · tool → · result"
        : `thinking off — enable with /thinking on or ${envVarName(APP_ENV.THINKING)}=1`,
    );
    return "handled";
  }
  setThinkingOverride(toggle);
  reply(`thinking ${toggle ? "on" : "off"} · ${describeObservabilityModes()}`);
  return "handled";
}

export function handleVerboseCommand(arg: string | undefined): ReplCommandResult {
  const toggle = parseToggle(arg);
  if (toggle === null) {
    reply("usage: /verbose on|off|status");
    return "handled";
  }
  if (toggle === "status") {
    reply(describeObservabilityModes());
    reply(
      isVerboseEnabled()
        ? "verbose on — context · tool_use_log · conversation · full trace"
        : `verbose off — enable with /verbose on or ${envVarName(APP_ENV.VERBOSE)}=1`,
    );
    return "handled";
  }
  setVerboseOverride(toggle);
  reply(`verbose ${toggle ? "on" : "off"} · ${describeObservabilityModes()}`);
  return "handled";
}
