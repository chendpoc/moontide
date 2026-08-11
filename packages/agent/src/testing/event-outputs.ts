import type { ErrorRecord } from "@moontide/shared/errors/record.js";

import type { AgentEventOutputs, PublishAgentErrorOptions } from "../agent/event-outputs.js";
import { publishHarnessAgentError } from "../log/publish-agent-error.js";

export type TestEventOutputsOptions = {
  /** When set, `writeDebugTerminal` appends formatted blocks here. */
  debugTerminal?: string[];
  onPublishError?: (record: ErrorRecord, options?: PublishAgentErrorOptions) => void;
};

/** Unit-test event outputs: structured errors via log hub; no CLI stderr unless caller opts in. */
export function createTestEventOutputs(
  options: TestEventOutputsOptions = {},
): AgentEventOutputs {
  const debugTerminal = options.debugTerminal;
  return {
    outputs: [],
    publishError: (record, opts) => {
      options.onPublishError?.(record, opts);
      publishHarnessAgentError(record, opts);
    },
    writeDebugTerminal: debugTerminal
      ? (formatted) => {
          debugTerminal.push(formatted);
        }
      : undefined,
  };
}
