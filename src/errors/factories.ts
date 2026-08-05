import { ErrorCode } from "./codes.js";
import { AppError, type AppErrorOptions } from "./app-error.js";

function create(code: ErrorCode, message: string, options?: AppErrorOptions): AppError {
  return new AppError(code, message, options);
}

export function validationError(message: string, options?: AppErrorOptions): AppError {
  return create(ErrorCode.VALIDATION, message, options);
}

export function configError(message: string, options?: AppErrorOptions): AppError {
  return create(ErrorCode.CONFIG, message, options);
}

export function toolError(message: string, options?: AppErrorOptions): AppError {
  return create(ErrorCode.TOOL, message, options);
}

export function infraError(message: string, options?: AppErrorOptions): AppError {
  return create(ErrorCode.INFRA, message, options);
}

export function internalError(message: string, options?: AppErrorOptions): AppError {
  return create(ErrorCode.INTERNAL, message, options);
}
