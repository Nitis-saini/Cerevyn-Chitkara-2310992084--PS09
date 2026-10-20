/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {

    proxy: { '/api': 'http://localhost:8787' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/tests/**/*.test.{ts,tsx}', 'server/tests/**/*.test.ts'],
    restoreMocks: true,
    
    testTimeout: 30_000,
  },
});
