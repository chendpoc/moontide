import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveRoute } from "@moontide/llm";

import { getAgentRuntime } from "../../apps/moontide/src/agent/runtime/index.js";
import { setupToolsPorts } from "../../apps/moontide/src/agent/tools-setup.js";
import { loadBootstrapEnv } from "../../apps/moontide/src/bootstrap-env.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apps/moontide");
loadBootstrapEnv(appRoot);

if (!process.env.DEEPSEEK_API_KEY?.trim() && !process.env.ANTHROPIC_API_KEY?.trim()) {
  process.env.DEEPSEEK_API_KEY = "sk-dev-startup-smoke";
}

setupToolsPorts();
const runtime = getAgentRuntime();
if (!runtime.tools.getTool("read_file")) {
  process.exit(2);
}

const route = resolveRoute();
if (!route.providerPresetId) {
  process.exit(3);
}

console.log("ok");
