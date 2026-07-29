import type { CodeRuntime } from "../types.js";
import { localBin, probeCommand, resolveCommand } from "./probe.js";

export const tsxRuntime: CodeRuntime = {
  id: "tsx",
  extensions: [".ts", ".tsx"],
  description: "TypeScript via tsx — Oculeau stack, quick scripts",
  async detect() {
    const cmd = localBin("tsx") ?? (await resolveCommand("tsx")) ?? "tsx";
    const probe = await probeCommand(cmd, ["--version"]);
    return {
      available: probe.ok,
      version: probe.version,
      command: cmd,
      error: probe.error,
    };
  },
  buildCommand(ctx) {
    const cmd = localBin("tsx") ?? "tsx";
    return { cmd, args: [ctx.filePath, ...ctx.args] };
  },
};
