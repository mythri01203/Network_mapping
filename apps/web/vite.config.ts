/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin, type ServerOptions } from 'vite';

const sharedSource = (file: string) => fileURLToPath(new URL(`../../packages/shared/src/${file}`, import.meta.url));
const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Every file in `public/`, as site paths. */
function publicFiles(dir = fromHere('./public')): string[] {
  if (!existsSync(dir)) return [];
  const walk = (folder: string): string[] =>
    readdirSync(folder).flatMap((name) => {
      const path = join(folder, name);
      return statSync(path).isDirectory() ? walk(path) : [`/${relative(dir, path).split('\\').join('/')}`];
    });
  return walk(dir);
}

/**
 * Writes dist/sw.js from the hand-written template in sw/service-worker.js, filling in the list of
 * built files to store at install. Runs only for `vite build`, so the dev server never has a worker.
 * Source maps and the older .woff copies of fonts (every phone in use reads .woff2) are left out.
 */
function serviceWorker(): Plugin {
  return {
    name: 'fibergis-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle)
        .filter((file) => !file.endsWith('.map') && !file.endsWith('.woff') && file !== 'index.html')
        .map((file) => `/${file}`);
      const fromPublic = publicFiles().filter((file) => !file.startsWith('/audio/') || file === '/audio/manifest.json');
      const precache = ['/index.html', ...fromPublic, ...built].sort();
      const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync(fromHere('./sw/service-worker.js'), 'utf8')
        .replace('__FIBERGIS_SW_VERSION__', version)
        .replace('__FIBERGIS_PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

/**
 * `virtual:fibergis-twin`: the 3D digital twin's scene code (the plain scripts in /digital-twin,
 * which are also built into a standalone HTML file) wrapped as a module for the Digital Twin page.
 * `startTwin(THREE, data)` runs the scripts with the app's three.js; `twinMarkup` is the page's
 * layout; `twinCss` is its stylesheet with every rule scoped under `.twin-root`, so it cannot
 * restyle the rest of the app.
 */
function digitalTwin(): Plugin {
  const dir = fromHere('../../digital-twin');
  const parts = ['twin-1-model.js', 'twin-2-scene.js', 'twin-3-equipment.js', 'twin-4-ui.js'];
  const id = 'virtual:fibergis-twin';
  const scopeCss = (css: string) =>
    css.replace(/(^|[{}])(\s*)([^{}@]+)\{/g, (_m, lead: string, space: string, selectors: string) => {
      const scoped = selectors
        .split(',')
        .map((sel) => sel.trim())
        .map((sel) =>
          sel === ':root' || sel === 'body' ? '.twin-root' : sel === '*' ? '.twin-root *' : `.twin-root ${sel}`,
        )
        .join(', ');
      return `${lead}${space}${scoped} {`;
    });
  return {
    name: 'fibergis-digital-twin',
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load(resolved) {
      if (resolved !== `\0${id}`) return null;
      for (const f of [...parts, 'template.html', 'twin.css']) this.addWatchFile(join(dir, f));
      const script = parts.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
      if (!script.includes('/*__DATA__*/ null')) throw new Error('digital-twin/twin-1-model.js has no data marker.');
      const html = readFileSync(join(dir, 'template.html'), 'utf8');
      const markup = html.slice(html.indexOf('<div class="wrap">'), html.indexOf('<script src='));
      return [
        `export const twinMarkup = ${JSON.stringify(markup)};`,
        `export const twinCss = ${JSON.stringify(scopeCss(readFileSync(join(dir, 'twin.css'), 'utf8')))};`,
        'export function startTwin(THREE, __twinData) {',
        script.replace('/*__DATA__*/ null', '__twinData'),
        'return window.twin;',
        '}',
      ].join('\n');
    },
  };
}

/**
 * `npm run dev:https -w @fibergis/web` serves the dev app over https so phones on the same network
 * can use the camera and GPS. It needs a certificate the phone trusts; see docs/DEPLOYMENT_GUIDE.md.
 * The normal `npm run dev` is unchanged.
 */
function httpsOptions(mode: string): ServerOptions['https'] | undefined {
  if (mode !== 'https') return undefined;
  const cert = process.env.FIBERGIS_HTTPS_CERT ?? fromHere('../../certs/dev-cert.pem');
  const key = process.env.FIBERGIS_HTTPS_KEY ?? fromHere('../../certs/dev-key.pem');
  if (!existsSync(cert) || !existsSync(key)) {
    throw new Error(
      `dev:https needs a certificate and key. Looked for ${cert} and ${key}. See docs/DEPLOYMENT_GUIDE.md, "Phones need https".`,
    );
  }
  return { cert: readFileSync(cert), key: readFileSync(key) };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), digitalTwin(), serviceWorker()],
  resolve: {
    // Resolve the workspace package from source so no build step or node_modules link is needed.
    alias: [
      { find: /^@fibergis\/shared$/, replacement: sharedSource('index.ts') },
      { find: /^@fibergis\/shared\/sample$/, replacement: sharedSource('sample/index.ts') },
    ],
  },
  server: {
    port: 5173,
    host: true,
    https: httpsOptions(mode),
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        // Keep the page's own address (for example localhost:5174) so the server's same-site check
        // matches it on any dev port. Requests from other websites are still refused.
        changeOrigin: false,
      },
    },
  },
  test: {
    setupFiles: ['./src/test/setup.ts'],
  },
}));
