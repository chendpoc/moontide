import "../packages/agent-cli/src/bootstrap.js";
import { setupToolsPorts } from "../packages/agent/src/agent/tools-setup.js";
import { registerBuiltinWorkMemPorts } from "../packages/agent/src/plugins/builtin/work-mem/register.js";
import "../packages/agent/src/tools/register-defaults.js";

setupToolsPorts();
registerBuiltinWorkMemPorts();
