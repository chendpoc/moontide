import path from "node:path";

const mode = process.argv[2];
const workspaceRoot = process.argv[3];

if (!workspaceRoot) {
  process.exit(1);
}

const appRoot = path.join(workspaceRoot, "apps", "moontide");

if (mode === "with-env") {
  const { loadBootstrapEnv } = await import("../../packages/agent-cli/src/bootstrap-env.js");
  loadBootstrapEnv(appRoot);
  const { resolveRoute } = await import("@moontide/llm");
  const route = resolveRoute();
  console.log(route.providerPresetId === "deepseek" ? "ok" : "bad-preset");
} else if (mode === "no-key") {
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const { loadBootstrapEnv } = await import("../../packages/agent-cli/src/bootstrap-env.js");
  loadBootstrapEnv(appRoot);
  const { resolveRoute } = await import("@moontide/llm");
  try {
    resolveRoute();
    console.log("unexpected-success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(message.includes("DEEPSEEK_API_KEY") ? "expected-failure" : "wrong-error");
  }
} else {
  process.exit(1);
}
