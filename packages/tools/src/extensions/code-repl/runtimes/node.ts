import type { CodeRuntime } from "../types.js";
import { probeCommand, resolveCommand } from "./probe.js";

export const nodeRuntime: CodeRuntime = {
  id: "node",
  extensions: [".js", ".mjs", ".cjs"],
  description: "Node.js — plain JavaScript files",
  async detect() {
    const cmd = (await resolveCommand("node")) ?? "node";
    const probe = await probeCommand(cmd, ["--version"]);
    return {
      available: probe.ok,
      version: probe.version,
      command: cmd,
      error: probe.error,
    };
  },
  buildCommand(ctx) {
    return { cmd: "node", args: [ctx.filePath, ...ctx.args] };
  },
};
