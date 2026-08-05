import type { ToolPermissionRule } from "./types.js";
import { TOOL_NAMES, type ToolName } from "./names.js";

/** Declarative permission table — single source for conformance tests. */
export const TOOL_PERMISSIONS: Record<ToolName, ToolPermissionRule> = {
  [TOOL_NAMES.BASH]: { kind: "bash", field: "command" },
  [TOOL_NAMES.READ_FILE]: { kind: "path", field: "path" },
  [TOOL_NAMES.WRITE_FILE]: { kind: "path", field: "path" },
  [TOOL_NAMES.EDIT_FILE]: { kind: "path", field: "path" },
  [TOOL_NAMES.GLOB]: { kind: "fixed", decision: "allow" },
  [TOOL_NAMES.LIST_DIR]: { kind: "path", field: "path" },
  [TOOL_NAMES.GREP]: { kind: "path", field: "path" },
  [TOOL_NAMES.HTTP_FETCH]: { kind: "fixed", decision: "ask" },
  [TOOL_NAMES.GIT_STATUS]: { kind: "fixed", decision: "allow" },
  [TOOL_NAMES.GIT_DIFF]: { kind: "path", field: "path" },
  [TOOL_NAMES.GIT_LOG]: { kind: "path", field: "path" },
  [TOOL_NAMES.GIT_SUMMARY]: { kind: "fixed", decision: "allow" },
  [TOOL_NAMES.INSPECT_CONTEXT]: { kind: "fixed", decision: "allow" },
  [TOOL_NAMES.READ_ARTIFACT]: { kind: "fixed", decision: "allow" },
  [TOOL_NAMES.ASK_USER_QUESTION]: { kind: "fixed", decision: "allow" },
  [TOOL_NAMES.CODE_REPL]: { kind: "fixed", decision: "allow" },
  [TOOL_NAMES.DEEP_RESEARCH]: { kind: "fixed", decision: "ask" },
  [TOOL_NAMES.WORK_MEM]: { kind: "fixed", decision: "allow" },
};
