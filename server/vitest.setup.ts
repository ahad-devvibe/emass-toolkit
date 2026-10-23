// Only the database name counts (not user, password or host): it must end in -test
function databaseName(url: string | undefined): string | undefined {
  try {
    return url ? decodeURIComponent(new URL(url).pathname.slice(1)) : undefined;
  } catch {
    return undefined;
  }
}

if (!databaseName(process.env.DATABASE_URL)?.endsWith("-test")) {
  throw new Error(
    "Refusing to run tests: DATABASE_URL must point to a database whose name ends in -test. " +
      "Tests run via `dotenv -e .env.test -- vitest run` — never load .env for tests.",
  );
}
