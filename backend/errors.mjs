export class PlatformError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'PlatformError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function errorRecord(error) {
  return {
    code: error.code ?? 'operation_failed',
    message: error.message ?? String(error),
    ...(error.details !== undefined ? { details: error.details } : {}),
  };
}
