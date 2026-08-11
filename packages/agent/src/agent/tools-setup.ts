import {
  setInspectContextPort,
  setToolsProductConfig,
  setWorkMemToolPort,
} from "@moontide/tools/ports";
import { getActiveWorkMemId, isDeepModeEnabled } from "./deep-mode.js";
import { inspectContext } from "../context-inspect/index.js";
import type { DetailLevel } from "../context-inspect/types.js";
import {
  codeReplDefaultRuntime,
  codeReplDisabled,
  codeReplTimeoutMs,
  deepResearchEnabled,
  httpFetchEnabled,
  pythonPath,
  tavilyApiKey,
  venvPath,
} from "../config.js";

let configured = false;

/** Bind product config and harness ports into @moontide/tools (idempotent). */
export function setupToolsPorts(): void {
  if (configured) {
    return;
  }
  configured = true;

  setToolsProductConfig({
    httpFetchEnabled,
    codeReplDisabled,
    codeReplDefaultRuntime,
    codeReplTimeoutMs,
    venvPath,
    pythonPath,
    deepResearchEnabled,
    tavilyApiKey,
  });

  setInspectContextPort({
    inspect: (detail, exact) => inspectContext(detail as DetailLevel, exact),
  });

  setWorkMemToolPort({
    isDeepModeEnabled,
    getActiveWorkMemId,
  });
}

/** Test-only: allow setupToolsPorts to run again after reset. */
export function resetToolsPortSetup(): void {
  configured = false;
}
