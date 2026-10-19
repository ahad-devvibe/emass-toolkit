export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    message: string,
    code: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(
    message: string,
    code = "BAD_REQUEST",
    details?: unknown,
  ): ApiError {
    return new ApiError(400, message, code, details);
  }

  static unauthorized(
    message = "Unauthorized",
    code = "UNAUTHORIZED",
    details?: unknown,
  ): ApiError {
    return new ApiError(401, message, code, details);
  }

  static notFound(
    message = "Not found",
    code = "NOT_FOUND",
    details?: unknown,
  ): ApiError {
    return new ApiError(404, message, code, details);
  }

  static conflict(
    message: string,
    code = "CONFLICT",
    details?: unknown,
  ): ApiError {
    return new ApiError(409, message, code, details);
  }
}
