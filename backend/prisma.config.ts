import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx --conditions=source prisma/seed.ts',
  },
  // `prisma generate` runs at install time on build servers, where no database is configured
  // and none is needed. Commands that do touch the database (migrate, seed) fail with a clear
  // connection error if DATABASE_URL is missing.
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
