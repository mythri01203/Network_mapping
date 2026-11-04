import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const sharedSource = (file: string) => fileURLToPath(new URL(`../../packages/shared/src/${file}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@fibergis\/shared$/, replacement: sharedSource('index.ts') },
      { find: /^@fibergis\/shared\/sample$/, replacement: sharedSource('sample/index.ts') },
    ],
  },
  test: {
    environment: 'node',
  },
});
