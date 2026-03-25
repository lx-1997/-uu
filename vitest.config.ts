import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/**/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'openclaw-main', 'openclaw-mini-main', 'dist'],
  },
});
