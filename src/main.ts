import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { getWorkdir } from "./config.js";
import { runAgent } from "./loop.js";

async function main(): Promise<void> {
  console.log("Oculus — coding agent");
  console.log(`Workspace: ${getWorkdir()}`);
  console.log("Enter a task, or q to quit.\n");

  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      const query = await rl.question("\x1b[36moculus >> \x1b[0m");
      const trimmed = query.trim();
      if (!trimmed || ["q", "exit"].includes(trimmed.toLowerCase())) {
        break;
      }
      const reply = await runAgent(trimmed);
      console.log(reply);
      console.log();
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
