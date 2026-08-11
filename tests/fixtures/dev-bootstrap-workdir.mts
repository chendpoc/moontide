await import("../../packages/agent-cli/src/bootstrap.js");
const { getWorkdir } = await import("../../packages/agent/src/config.js");

console.log(getWorkdir());
