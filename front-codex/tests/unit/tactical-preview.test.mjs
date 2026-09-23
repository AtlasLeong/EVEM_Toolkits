import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import viteConfig from '../../vite.config.js';

const config = (command, mode) => typeof viteConfig === 'function' ? viteConfig({ command, mode }) : viteConfig;

test('explicit tactical development mode always uses loopback API', () => {
  assert.equal(config('serve', 'tactical-local').define?.['import.meta.env.VITE_API_URL'], JSON.stringify('http://127.0.0.1:8001/api'));
});
test('tactical preview override never leaks into builds or ordinary development', () => {
  for (const [command, mode] of [['build', 'tactical-local'], ['build', 'production'], ['serve', 'development']]) {
    assert.equal(config(command, mode).define?.['import.meta.env.VITE_API_URL'], undefined);
  }
});
test('local startup command uses explicit mode, loopback and strict port', async () => {
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['dev:tactical'] || '', /--mode tactical-local/);
  assert.match(pkg.scripts['dev:tactical'], /--host 127\.0\.0\.1.*--port 4194.*--strictPort/);
});
