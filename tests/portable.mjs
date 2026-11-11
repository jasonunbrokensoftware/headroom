import { copyFile, cp, mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const codex = process.env.HEADROOM_TEST_CODEX;
assert.ok(codex, 'Set HEADROOM_TEST_CODEX to the installed CLI for this isolated migration test');
const root = path.resolve('.test-data/portable-' + Date.now());
const first = path.join(root, 'first'), moved = path.join(root, 'moved'), unrelated = path.join(root, 'working-directory');
const id = randomUUID().replaceAll('-', '');
const home = path.join(first, 'data/accounts', id);
await mkdir(home, { recursive: true }); await mkdir(unrelated, { recursive: true });
await copyFile(process.env.HEADROOM_TEST_EXE || path.resolve('artifacts/single-exe/Headroom.exe'), path.join(first, 'Headroom.exe'));
await writeFile(path.join(first, 'settings.json'), JSON.stringify({ codexPath: codex }));
await writeFile(path.join(first, 'data/accounts.json'), JSON.stringify([{ id }]));
const fakeKey = 'headroom-portability-test-not-a-real-key';
function cli(args, input) {
  const result = spawnSync(codex, ['-c', 'cli_auth_credentials_store="keyring"', ...args], {
    cwd: unrelated, env: { ...process.env, CODEX_HOME: home }, windowsHide: true, input, encoding: 'utf8', timeout: 30000
  });
  assert.equal(result.status, 0, 'Disposable CLI operation failed');
}
async function run(folder, damaged = false) {
  const child = spawn(path.join(folder, 'Headroom.exe'), ['--headless'], { cwd: unrelated, windowsHide: true, stdio: 'ignore' });
  const done = new Promise(resolve => child.on('exit', resolve));
  let url;
  try {
    for (let i = 0; i < 200; i++) {
      try { url = new URL(JSON.parse(await readFile(path.join(folder, 'data/instance.json'), 'utf8')).url); if (await fetch(url.origin).then(r => r.ok)) break; } catch { url = undefined; }
      await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(url, 'Portable server starts');
    let state;
    for (let i = 0; i < 300; i++) {
      state = await (await fetch(url.origin + '/api/accounts', { headers: { 'X-Session': url.hash.slice(1) } })).json();
      if (state.accounts.every(a => (a.updatedAt || a.error) && !a.busy)) break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.equal(state.accounts.length, 1);
    if (damaged) {
      assert.ok(state.accounts[0].error, 'Damaged encrypted credentials fail closed');
      await assert.rejects(readFile(path.join(home, 'auth.json')), { code: 'ENOENT' });
      return;
    }
    assert.ok(state.accounts.every(a => !a.error && a.updatedAt), state.accounts.map(a => a.error).join('; '));
    const accountHome = path.join(folder, 'data/accounts', id);
    assert.equal(JSON.parse(await readFile(path.join(accountHome, 'auth.json'), 'utf8')).OPENAI_API_KEY, fakeKey);
    assert.ok((await readFile(path.join(accountHome, 'config.toml'), 'utf8')).includes('cli_auth_credentials_store = "file"'));
    assert.deepEqual(await readdir(unrelated), [], 'Nothing saved relative to the working directory');
  } finally {
    if (url) await fetch(url.origin + '/api/quit', { method: 'POST', headers: { 'X-Session': url.hash.slice(1) } }).catch(() => {});
    const timer = setTimeout(() => child.kill(), 10000);
    assert.equal(await done, 0); clearTimeout(timer);
  }
}
try {
  cli(['login', '--with-api-key'], fakeKey);
  const agePath = path.join(home, 'secrets/codex_auth.age');
  const original = await readFile(agePath), damaged = Buffer.from(original); damaged[damaged.length - 1] ^= 1;
  await writeFile(agePath, damaged);
  await run(first, true);
  await writeFile(agePath, original);
  console.log('PASS damaged credentials are rejected without writing a partial sign-in');
  await run(first);
  console.log('PASS existing Windows keyring sign-in converts losslessly to local file storage');
  await cp(first, moved, { recursive: true });
  await unlink(path.join(moved, 'data/accounts', id, 'secrets/codex_auth.age'));
  await run(moved);
  console.log('PASS moving the EXE and data preserves settings and sign-in with a different working directory');
} finally { cli(['logout']); }
