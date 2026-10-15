/**
 * HTTP error with structured status code and optional details.
 * Used for consistent error handling in API routes.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

/**
 * Type guard to check if an error is an HttpError.
 */
export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}
