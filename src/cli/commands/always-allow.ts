import { APP_ENV, envVarName } from "../../constants/env.js";
import {
  describeAlwaysAllow,
  isAlwaysAllowEnabled,
  setAlwaysAllowOverride,
} from "../../tools/always-allow-mode.js";
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

export function handleAlwaysAllowCommand(arg: string | undefined): ReplCommandResult {
  const toggle = parseToggle(arg);
  if (toggle === null) {
    reply("usage: /always-allow on|off|status");
    return "handled";
  }
  if (toggle === "status") {
    reply(describeAlwaysAllow());
    reply(
      isAlwaysAllowEnabled()
        ? "ask-class tools auto-approved (deny rules still apply)"
        : `always allow off — enable with /always-allow on or ${envVarName(APP_ENV.ALWAYS_ALLOW)}=1`,
    );
    return "handled";
  }
  setAlwaysAllowOverride(toggle);
  reply(`${describeAlwaysAllow()} (session override)`);
  return "handled";
}
