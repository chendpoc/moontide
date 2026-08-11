const workdir = process.argv[2];
if (!workdir) {
  process.exit(1);
}

process.env.MOONTIDE_WORKDIR = workdir;
process.env.DEEPSEEK_API_KEY = "sk-cold-start";
process.env.MOONTIDE_ENV = "production";

await import("../../packages/agent-cli/src/bootstrap.js");

const { setLLMProvider } = await import("@moontide/llm");
const { runAgent } = await import("../../packages/agent/src/agent/loop.js");
const { createCliEventOutputs } = await import("../../packages/agent-cli/src/log/cli-event-outputs.js");

setLLMProvider({
  chat: async () => ({
    content: [{ type: "text", text: "cold-ok" }],
    stopReason: "end_turn",
    usage: { inputTokens: 1, outputTokens: 1 },
  }),
  countTokens: async () => 1,
});

const reply = await runAgent("hi", createCliEventOutputs(workdir));
console.log(reply === "cold-ok" ? "ok" : `bad:${reply}`);
