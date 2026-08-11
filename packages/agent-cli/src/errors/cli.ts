import { formatErrorTerminal } from "../log/format/format-error.js";
import { cliExitCodeFor } from "@moontide/shared/errors/codes.js";
import { toMessage } from "@moontide/shared/errors/normalize.js";
import { toErrorRecord, type ErrorRecord } from "@moontide/shared/errors/record.js";

export function formatCliError(err: unknown, source = "cli"): string {
  return formatErrorTerminal(toErrorRecord(err, source));
}

export function cliExitCode(err: unknown): number {
  const record = toErrorRecord(err, "cli");
  return cliExitCodeFor(record.code);
}

export function formatCliErrorFromRecord(record: ErrorRecord): string {
  return formatErrorTerminal(record);
}

export { toMessage };
