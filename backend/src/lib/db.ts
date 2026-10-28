import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: 20,
  // A hosted database that scales to zero (Neon) can take several seconds to wake up.
  connectionTimeoutMillis: 15_000,
});

export const prisma = new PrismaClient({
  adapter,
  // Prisma's defaults (2 s to start a transaction, 5 s to finish it) are too tight for a remote
  // database that may be waking up, and for large writes such as a curriculum import.
  transactionOptions: { maxWait: 15_000, timeout: 60_000 },
});

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export type Db = typeof prisma | Tx;

export * from '../generated/prisma/client.js';
