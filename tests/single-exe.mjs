import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

const source = process.env.HEADROOM_TEST_EXE || path.resolve('artifacts/single-exe/Headroom.exe');
const taskbarSource = await readFile(path.resolve('native/Headroom.Taskbar.cpp'), 'utf8');
assert.ok(!/\b(?:ShowWindow|SetWindowPlacement|SetWindowPos|SetForegroundWindow|DeleteTab|AddTab)\s*\(/.test(taskbarSource),
  'Icon synchronization must not change window visibility, placement, focus or taskbar membership');
const directory = path.resolve('.test-data/single-exe-' + Date.now());
await mkdir(directory, { recursive: true });
const exe = path.join(directory, 'Headroom.exe');
await copyFile(source, exe);
const pe = await readFile(exe), nt = pe.readUInt32LE(0x3c), opt = nt + 24;
assert.equal(pe.readUInt16LE(opt), 0x20b);
assert.equal(pe.readUInt32LE(opt + 112 + 14 * 8), 0, 'Native AOT has no CLR header');
const count = pe.readUInt16LE(nt + 6), sections = opt + pe.readUInt16LE(nt + 20);
function position(rva) {
  for (let i = 0; i < count; i++) {
    const s = sections + 40 * i, start = pe.readUInt32LE(s + 12);
    if (rva >= start && rva < start + Math.max(pe.readUInt32LE(s + 8), pe.readUInt32LE(s + 16)))
      return pe.readUInt32LE(s + 20) + rva - start;
  }
  throw new Error('Invalid PE section');
}
const imports = [];
for (let p = position(pe.readUInt32LE(opt + 112 + 8)); pe.readUInt32LE(p + 12); p += 20) {
  const name = position(pe.readUInt32LE(p + 12));
  imports.push(pe.toString('ascii', name, pe.indexOf(0, name)).toLowerCase());
}
assert.ok(!imports.some(name => /photino|webview2loader|vcruntime|msvcp/.test(name)), imports.join(', '));
assert.equal(pe.readUInt32LE(opt + 112 + 13 * 8), 0, 'No delay-loaded DLLs');
assert.deepEqual(await readdir(directory), ['Headroom.exe']);
const run = spawnSync(exe, ['--self-test'], { cwd: directory, windowsHide: true, encoding: 'utf8', timeout: 60000 });
assert.equal(run.status, 0, run.stdout + run.stderr);
assert.ok(run.stdout.includes('Statically linked Photino and WebView2 loader'));
assert.ok(!(await readdir(directory)).some(name => name.endsWith('.dll')));
console.log('PASS native EXE imports only system DLLs and runs native loader tests alone in an empty folder');
