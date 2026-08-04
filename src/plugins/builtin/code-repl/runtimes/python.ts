import { pythonPath, venvPath } from "../../../../config.js";
import { joinPath, resolvePath } from "../../../../utils/path.js";
import type { CodeRuntime } from "../types.js";
import { buildRuntimeEnv } from "./env.js";
import { probeCommand, resolveCommand } from "./probe.js";

export const pythonRuntime: CodeRuntime = {
  id: "python",
  extensions: [".py"],
  description: "Python — ML, training scripts, data science",
  async detect() {
    const env = buildRuntimeEnv();
    const configured = pythonPath();
    const candidates = configured
      ? [configured]
      : [joinPath(venvPath() ?? "", "bin", "python"), "python3", "python"].filter(Boolean);

    for (const candidate of candidates) {
      const cmd =
        candidate.includes("/") || candidate.includes("\\")
          ? resolvePath(candidate)
          : ((await resolveCommand(candidate)) ?? candidate);
      const probe = await probeCommand(cmd, ["--version"], env);
      if (probe.ok) {
        return {
          available: true,
          version: probe.version,
          command: cmd,
        };
      }
    }

    return {
      available: false,
      error: "python interpreter not found (set OCULA_PYTHON or OCULA_VENV)",
    };
  },
  buildCommand(ctx) {
    const configured = pythonPath();
    const cmd = configured ?? "python3";
    return { cmd, args: [ctx.filePath, ...ctx.args] };
  },
};
