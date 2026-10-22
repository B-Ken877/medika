import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./tests/global-setup.js'],
    environment: 'node',
    // Sequential files: one shared embedded PostgreSQL per run.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['tests/**/*.test.js'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: false },
    },
  },
});
