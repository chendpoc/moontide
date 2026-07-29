import type { CodeRuntime } from "../types.js";
import { probeCommand } from "./probe.js";

export const bashRuntime: CodeRuntime = {
  id: "bash",
  extensions: [".sh"],
  description: "Bash shell scripts — git summary, find, which",
  async detect() {
    const probe = await probeCommand("/bin/bash", ["--version"]);
    return {
      available: probe.ok,
      version: probe.version,
      command: "/bin/bash",
      error: probe.error,
    };
  },
  buildCommand(ctx) {
    return { cmd: "/bin/bash", args: [ctx.filePath, ...ctx.args] };
  },
};
