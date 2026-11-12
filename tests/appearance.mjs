import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

// Copy the EXE so the test can never change the installed app's portable settings.
const source = process.env.HEADROOM_TEST_EXE || path.resolve('artifacts/single-exe/Headroom.exe');
const directory = path.resolve('.test-data/appearance-' + Date.now());
await mkdir(directory, { recursive: true });
const exe = path.join(directory, 'Headroom.exe'), settingsPath = path.join(directory, 'settings.json');
await copyFile(source, exe);
const existing = { codexPath: 'tools/example-codex.exe', startWithWindows: true };
await writeFile(settingsPath, JSON.stringify(existing));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let child, done, origin, key, errors;
async function start() {
  errors = '';
  // Headless mode skips the tray and Windows startup registration. Empty accounts
  // ensure these checks don't open sign-in or contact the service.
  child = spawn(exe, ['--headless'], { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', bytes => errors += bytes);
  done = new Promise(resolve => child.once('exit', code => resolve(code)));
  for (let i = 0; i < 100; i++) {
    assert.equal(child.exitCode, null, 'Server exited: ' + errors);
    try {
      const url = new URL(JSON.parse(await readFile(path.join(directory, 'data/instance.json'), 'utf8')).url);
      origin = url.origin; key = url.hash.slice(1); return;
    } catch { await delay(100); }
  }
  throw new Error('Headless server did not start: ' + errors);
}
const api = (body, extra = {}) => fetch(origin + '/api/appearance', {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'X-Session': key, 'Content-Type': 'application/json', ...extra },
  body: body === undefined ? undefined : JSON.stringify(body)
});
async function stop() {
  if (!child || child.exitCode !== null) return;
  await fetch(origin + '/api/quit', { method: 'POST', headers: { 'X-Session': key } });
  assert.equal(await Promise.race([done, delay(8000).then(() => 'timeout')]), 0, 'Clean shutdown');
  child = null;
}
async function pageTheme(theme) {
  assert.ok((await (await fetch(origin + '/')).text()).includes('data-theme="' + theme + '"'), 'Saved theme is rendered before first paint');
}
try {
  await start();
  assert.equal((await fetch(origin + '/api/appearance')).status, 401);
  assert.equal((await api({ theme: 'lagoon' }, { Origin: 'https://example.org' })).status, 403);
  assert.deepEqual(await (await api()).json(), { theme: 'ember' });
  await pageTheme('ember');
  assert.ok((await (await fetch(origin + '/appearance.js')).text()).includes('resolveTheme'));
  for (const theme of ['orchard', 'lagoon', 'rosewood', 'ember']) {
    const result = await api({ theme });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { theme });
    assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), { ...existing, theme });
    await pageTheme(theme);
  }
  const beforeInvalid = await readFile(settingsPath, 'utf8');
  for (const body of [{ theme: 'unknown' }, { theme: '<script>' }, { theme: null }, {}])
    assert.equal((await api(body)).status, 400);
  assert.equal(await readFile(settingsPath, 'utf8'), beforeInvalid);
  assert.equal((await api({ theme: 'rosewood' })).status, 200);
  await stop();
  await start();
  assert.deepEqual(await (await api()).json(), { theme: 'rosewood' });
  await pageTheme('rosewood');
  assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf8')), { ...existing, theme: 'rosewood' });
  await stop();
  // Unsupported values from an older/newer installation fall back safely.
  await writeFile(settingsPath, JSON.stringify({ ...existing, theme: 'retired' }));
  await start();
  assert.deepEqual(await (await api()).json(), { theme: 'ember' });
  await pageTheme('ember');
  console.log('PASS isolated portable themes: authentication, validation, initial paint, all palettes, preserved settings, restart, and fallback');
} finally {
  try { await stop(); } finally { if (child && child.exitCode === null) child.kill(); }
}
