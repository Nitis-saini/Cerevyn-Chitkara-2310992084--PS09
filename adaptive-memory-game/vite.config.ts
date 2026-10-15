/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    // Full-round UI tests on the 36-card board can take several seconds on slow machines.
    testTimeout: 30_000,
  },
});
