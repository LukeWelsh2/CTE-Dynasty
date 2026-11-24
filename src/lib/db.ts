import { PrismaClient } from "@prisma/client";

// Single Prisma client per process (survives Next.js dev hot reloads)
const g = globalThis as unknown as { __prisma?: PrismaClient };

export const db: PrismaClient =
  g.__prisma ??
  new PrismaClient({
    log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") g.__prisma = db;
