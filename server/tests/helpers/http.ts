/**
 * Express/supertest types `set-cookie` as a single string, but Node always
 * sends it as an array — normalize for test assertions.
 */
export function setCookies(headers: Record<string, unknown>): string[] {
  const value = headers["set-cookie"];
  if (Array.isArray(value)) return value as string[];
  if (typeof value === "string") return [value];
  return [];
}

/**
 * The live `refreshToken=<value>` pair from a response, ready to send back as
 * a Cookie header (skips the clearing cookies set for the legacy path).
 */
export function refreshCookie(headers: Record<string, unknown>): string {
  const cookie = setCookies(headers).find(
    (c) => c.startsWith("refreshToken=") && !c.startsWith("refreshToken=;"),
  );
  if (!cookie) throw new Error("response did not set a refreshToken cookie");
  return cookie.split(";")[0];
}
