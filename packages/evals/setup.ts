import "../../apps/moontide/src/bootstrap.js";
import { setupToolsPorts } from "../../apps/moontide/src/agent/tools-setup.js";
import { registerBuiltinWorkMemPorts } from "../../apps/moontide/src/plugins/builtin/work-mem/register.js";
import "../../apps/moontide/src/tools/register-defaults.js";

setupToolsPorts();
registerBuiltinWorkMemPorts();
