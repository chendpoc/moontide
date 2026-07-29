import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { renderStatusLine } from "./cli/statusline/render.js";
import {
  isEventsMode,
  setCliEventsArgv,
  setContextCliOverride,
  setEventsDisplayCliOverride,
  setEventsOverride,
  setTraceCliOverride,
} from "./events/cli-session.js";
import { refreshEventSinks, setupEventPipeline } from "./events/setup.js";
import { runAgent } from "./loop.js";

function handleReplCommand(trimmed: string): boolean {
  const lower = trimmed.toLowerCase();

  if (lower === "/trace on") {
    setTraceCliOverride(true);
    return true;
  }
  if (lower === "/trace off") {
    setTraceCliOverride(false);
    return true;
  }
  if (lower === "/events on") {
    setEventsOverride(true);
    refreshEventSinks();
    return true;
  }
  if (lower === "/events off") {
    setEventsOverride(false);
    refreshEventSinks();
    return true;
  }
  if (lower === "/events-display on") {
    setEventsDisplayCliOverride(true);
    return true;
  }
  if (lower === "/events-display off") {
    setEventsDisplayCliOverride(false);
    return true;
  }
  if (lower === "/context on") {
    setContextCliOverride(true);
    return true;
  }
  if (lower === "/context off") {
    setContextCliOverride(false);
    return true;
  }

  return false;
}

async function main(): Promise<void> {
  const eventsFlag = process.argv.slice(2).includes("--events");
  setCliEventsArgv(eventsFlag);
  setupEventPipeline();

  console.error(
    "Oculeau — /context · /trace · /events · /events-display (on|off)\n",
  );

  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      renderStatusLine();
      const query = await rl.question("\x1b[36mOculeau >> \x1b[0m");
      const trimmed = query.trim();
      if (!trimmed || ["q", "exit"].includes(trimmed.toLowerCase())) {
        break;
      }
      if (handleReplCommand(trimmed)) {
        continue;
      }

      const reply = await runAgent(trimmed);

      if (!isEventsMode()) {
        console.log(reply);
        console.log();
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
