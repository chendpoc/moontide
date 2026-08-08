import type { ToolCapability } from "./types.js";
import { TOOL_NAMES, type ToolName } from "./names.js";

/** Declarative capability table — single source for conformance tests. */
export const TOOL_CAPABILITIES: Record<ToolName, ToolCapability> = {
  [TOOL_NAMES.BASH]: "exec",
  [TOOL_NAMES.READ_FILE]: "read",
  [TOOL_NAMES.WRITE_FILE]: "write",
  [TOOL_NAMES.EDIT_FILE]: "write",
  [TOOL_NAMES.GLOB]: "read",
  [TOOL_NAMES.LIST_DIR]: "read",
  [TOOL_NAMES.GREP]: "read",
  [TOOL_NAMES.HTTP_FETCH]: "network",
  [TOOL_NAMES.GIT_STATUS]: "read",
  [TOOL_NAMES.GIT_DIFF]: "read",
  [TOOL_NAMES.GIT_LOG]: "read",
  [TOOL_NAMES.GIT_SUMMARY]: "read",
  [TOOL_NAMES.INSPECT_CONTEXT]: "read",
  [TOOL_NAMES.READ_ARTIFACT]: "read",
  [TOOL_NAMES.ASK_USER_QUESTION]: "read",
  [TOOL_NAMES.CODE_REPL]: "exec",
  [TOOL_NAMES.DEEP_RESEARCH]: "network",
  [TOOL_NAMES.WORK_MEM]: "mixed",
};
