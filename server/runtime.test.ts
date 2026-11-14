import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('loads application modules with the installed native TypeScript runtime', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', "await import('./server/job-manager.ts'); await import('./server/knowledge.ts'); process.stdout.write('loaded');"], { cwd: root, windowsHide: true, timeout: 30_000 });
  expect(output.stdout).toBe('loaded');
});
