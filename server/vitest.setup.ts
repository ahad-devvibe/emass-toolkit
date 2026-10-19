if (!process.env.DATABASE_URL?.includes("_test")) {
  throw new Error(
    "Refusing to run tests: DATABASE_URL must point to a _test database. " +
      "Tests run via `dotenv -e .env.test -- vitest run` — never load .env for tests.",
  );
}
