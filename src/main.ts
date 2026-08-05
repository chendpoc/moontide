import "./bootstrap.js";

import { runRepl } from "./cli/repl/run.js";

import { formatCliError, cliExitCode } from "./errors/cli.js";
import { writeStderrBlock } from "./terminal/write.js";

runRepl().catch((error) => {
  writeStderrBlock(formatCliError(error));
  process.exit(cliExitCode(error));
});
