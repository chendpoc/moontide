import { describe, expect, it } from "vitest";

import { ErrorCode } from "@moontide/shared/errors/codes.js";
import { formatErrorTerminal, formatPluginErrorEvent } from "../packages/agent-cli/src/log/format/format-error.js";
import { stripAnsi } from "@moontide/shared/utils/text.js";

describe("formatErrorTerminal", () => {
  it("renders code, message, and context without stack by default", () => {
    const text = stripAnsi(
      formatErrorTerminal(
        {
          code: ErrorCode.INFRA,
          message: "Sidecar process missing stdout",
          source: "plugin:hello",
          turn: 2,
          hook: "hello",
          context: { pluginId: "hello", transport: "stdio" },
          stack: "Error: Sidecar\n    at start (process-transport.ts:50)",
        },
        { verbose: false, includeHint: false },
      ),
    );

    expect(text).toContain("ERROR");
    expect(text).toContain("infra");
    expect(text).toContain("Sidecar process missing stdout");
    expect(text).toContain("pluginId=hello");
    expect(text).not.toContain("process-transport.ts");
  });

  it("includes stack when verbose", () => {
    const text = stripAnsi(
      formatErrorTerminal(
        {
          code: ErrorCode.TOOL,
          message: "Unknown tool",
          source: "executeTool",
          stack: "Error: Unknown tool\n    at executeTool (execute.ts:13)",
        },
        { verbose: true, includeHint: false },
      ),
    );

    expect(text).toContain("execute.ts:13");
  });
});

describe("formatPluginErrorEvent", () => {
  it("formats plugin_error payloads for terminal channels", () => {
    const text = stripAnsi(
      formatPluginErrorEvent({
        turn: 2,
        preview: "tool-use-log/toolUse",
        payload: {
          errorCode: ErrorCode.INTERNAL,
          message: "boom",
          source: "hook:tool-use-log",
          toolName: "bash",
        },
      }) ?? "",
    );

    expect(text).toContain("internal");
    expect(text).toContain("boom");
    expect(text).toContain("bash");
  });
});
