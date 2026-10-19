export class ApiResponse<T> {
  readonly success: true;
  readonly statusCode: number;
  readonly message: string;
  readonly data?: T;

  private constructor(message: string, statusCode: number, data?: T) {
    this.success = true;
    this.message = message;
    this.statusCode = statusCode;
    if (data !== undefined) {
      this.data = data;
    }
  }

  static success<T>(data: T, message = "OK", statusCode = 200): ApiResponse<T> {
    return new ApiResponse(message, statusCode, data);
  }

  static ok(message = "OK", statusCode = 200): ApiResponse<never> {
    return new ApiResponse(message, statusCode);
  }
}
