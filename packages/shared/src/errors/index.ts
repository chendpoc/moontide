export { ErrorCode, type ErrorCode as ErrorCodeType, cliExitCodeFor } from "./codes.js";
export { AppError, isAppError, type AppErrorOptions } from "./app-error.js";
export {
  validationError,
  configError,
  toolError,
  infraError,
  internalError,
} from "./factories.js";
export {
  type ErrorRecord,
  toErrorRecord,
  errorRecordToEventPayload,
  isErrorRecord,
} from "./record.js";
export { toMessage, toStack, errorCodeOf } from "./normalize.js";
export {
  toolFailureMessage,
  toFailureOutcome,
  errorCodeFromToolOutcome,
  type ToolOutcomeForErrorCode,
} from "./outcome.js";
