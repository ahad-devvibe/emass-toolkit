import { Prisma } from "@prisma/client";
import { ApiError } from "../../utils/api-error.utils.js";

export function presentUser<T extends { password?: string | null }>(
  user: T,
): Omit<T, "password"> {
  const rest = { ...user };
  delete (rest as { password?: unknown }).password;
  return rest as Omit<T, "password">;
}

export function translateUniqueSignupError(err: unknown): void {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new ApiError(
      409,
      "An account with this email already exists",
      "EMAIL_TAKEN",
    );
  }
}
