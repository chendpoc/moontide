import {
  createAgentRuntime,
  getAgentRuntime,
  setAgentRuntime,
} from "../../packages/agent/src/agent/runtime/index.js";
import { setupToolsPorts } from "../../packages/agent/src/agent/tools-setup.js";

const mode = process.argv[2];

if (mode === "wrong-order") {
  try {
    createAgentRuntime();
    console.log("unexpected-success");
  } catch {
    console.log("expected-failure");
  }
} else if (mode === "wrong-order-get-runtime") {
  setAgentRuntime(undefined);
  try {
    getAgentRuntime();
    console.log("unexpected-success");
  } catch {
    console.log("expected-failure");
  }
} else if (mode === "correct-order") {
  setupToolsPorts();
  const runtime = createAgentRuntime();
  console.log(runtime.tools.getTool("read_file") ? "ok" : "missing-tools");
} else if (mode === "correct-order-get-runtime") {
  setAgentRuntime(undefined);
  setupToolsPorts();
  const runtime = getAgentRuntime();
  console.log(runtime.tools.getTool("read_file") ? "ok" : "missing-tools");
} else {
  process.exit(1);
}
