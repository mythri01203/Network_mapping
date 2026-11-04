// Bundles the API, together with the shared package source it imports, into dist/main.js.
// Runtime dependencies stay external and are resolved from node_modules.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const fromRoot = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const pkg = JSON.parse(await readFile(fromRoot('package.json'), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((name) => !name.startsWith('@fibergis/'));

await build({
  entryPoints: [fromRoot('src/main.ts')],
  outfile: fromRoot('dist/main.js'),
  tsconfig: fromRoot('tsconfig.json'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external,
  logLevel: 'info',
});
