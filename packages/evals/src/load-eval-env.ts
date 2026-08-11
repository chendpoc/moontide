import path from "node:path";
import { fileURLToPath } from "node:url";

import { findWorkspaceRoot, loadWorkspaceEnv } from "@moontide/agent/load-env";

const evalRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadWorkspaceEnv(findWorkspaceRoot(evalRoot));
