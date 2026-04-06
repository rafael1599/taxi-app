import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Only pick up .ts test files; exclude compiled .js artifacts in the same folder
    include: ['test/**/*.test.ts'],
  },
});
