/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const sharedSource = (file: string) => fileURLToPath(new URL(`../../packages/shared/src/${file}`, import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Resolve the workspace package from source so no build step or node_modules link is needed.
    alias: [
      { find: /^@fibergis\/shared$/, replacement: sharedSource('index.ts') },
      { find: /^@fibergis\/shared\/sample$/, replacement: sharedSource('sample/index.ts') },
    ],
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
  test: {
    setupFiles: ['./src/test/setup.ts'],
  },
});
