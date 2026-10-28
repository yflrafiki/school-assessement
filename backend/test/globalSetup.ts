import { execSync } from 'node:child_process';
import 'dotenv/config';

/** Applies migrations to the test database once per run. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must be set (see backend/.env.example)');
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    // Both names point at the test database, so a MIGRATION_DATABASE_URL in .env can never
    // send test migrations elsewhere.
    env: { ...process.env, DATABASE_URL: url, MIGRATION_DATABASE_URL: url },
  });
}
