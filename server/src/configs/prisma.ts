import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "@prisma/client";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

export const prisma = new PrismaClient({
  adapter,
  log: [
    {
      emit: "event",
      level: "query",
    },
  ],
});

if (process.env.NODE_ENV === "development") {
  prisma.$on("query", (e: Prisma.QueryEvent) => {
    console.log("SQL:", e.query);
    console.log("Params:", e.params);
    console.log("Duration:", `${e.duration}ms`);
  });
}
