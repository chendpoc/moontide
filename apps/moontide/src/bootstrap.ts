import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadBootstrapEnv } from "./bootstrap-env.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadBootstrapEnv(appRoot);
