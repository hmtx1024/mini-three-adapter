import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    // Single-process execution keeps Vitest's SSR transform cache off the
    // Windows temp directory (which is often write-restricted in sandboxes).
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    cache: false,
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts', 'src/polyfills/**/*.ts', 'src/build/**/*.ts'],
    },
  },
});
