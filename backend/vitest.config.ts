import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    environment: 'node',
    env: { NODE_ENV: 'test', DISABLE_RATE_LIMIT: 'true' },
    globalSetup: ['./test/globalSetup.ts'],
    // Integration tests share one PostgreSQL database and truncate it, so files run one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
