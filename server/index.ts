import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { Store } from './store.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const store = new Store(resolve(root, 'data'));
const { app } = createApp({ store });
app.get('*', serveStatic({ root: resolve(root, 'dist') }));
app.get('*', serveStatic({ path: resolve(root, 'dist/index.html') }));
const port = Number(process.env['PORT'] ?? '4317');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local app port.');
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => {
  process.stdout.write(`Solution Lab: http://127.0.0.1:${port}\n`);
});
