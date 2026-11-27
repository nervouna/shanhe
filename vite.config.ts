import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2023',
  },
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
    maxWorkers: 2,
  },
});
