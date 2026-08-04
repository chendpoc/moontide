import "./bootstrap.js";

import { runRepl } from "./cli/repl/run.js";

import { writeStderrLine } from "./terminal/write.js";

runRepl().catch((error) => {
  writeStderrLine(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
