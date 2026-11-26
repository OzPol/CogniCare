import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

const state = globalThis as typeof globalThis & { cogniDb?: PrismaClient };

export type Tx = Prisma.TransactionClient;

export function database() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  state.cogniDb ??= new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 8,
      connectionTimeoutMillis: 2_500,
      idleTimeoutMillis: 10_000,
    }),
  });
  return state.cogniDb;
}
