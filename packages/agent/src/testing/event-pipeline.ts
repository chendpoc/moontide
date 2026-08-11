import type { ErrorRecord } from "@moontide/shared/errors/record.js";

import type { AgentEventPipeline, PublishAgentErrorOptions } from "../agent/event-pipeline.js";
import { publishHarnessAgentError } from "../log/publish-agent-error.js";

export type TestEventPipelineOptions = {
  /** When set, `writeDebugTerminal` appends formatted blocks here. */
  debugTerminal?: string[];
  onPublishError?: (record: ErrorRecord, options?: PublishAgentErrorOptions) => void;
};

/** Unit-test pipeline: structured errors via log hub; no CLI stderr unless caller opts in. */
export function createTestEventPipeline(
  options: TestEventPipelineOptions = {},
): AgentEventPipeline {
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
