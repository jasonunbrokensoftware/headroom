import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';

const base = process.cwd();
const exe = process.env.HEADROOM_TEST_EXE || path.join(base, 'artifacts/single-exe/Headroom.exe');
const data = process.env.HEADROOM_TEST_DATA || path.join(base, '.test-data/http-' + Date.now());
await mkdir(data, { recursive: true });
if (!process.env.HEADROOM_TEST_DATA) await writeFile(path.join(data, 'accounts.json'), JSON.stringify(Array.from({length:7}, (_,i)=>({id:randomUUID().replaceAll('-',''), name:'Obsolete custom name', email:`test${i}@example.com`, workspaceName:`Workspace ${i}`, workspaceId:`workspace-${i}`, plan:'business'}))));
const child = process.env.HEADROOM_TEST_DATA ? null : spawn(exe, ['--headless', '--data-dir', data], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let errors = '';
child?.stderr.on('data', b => errors += b);
const done = child ? new Promise(resolve => child.on('exit', code => resolve(code))) : Promise.resolve(0);
let url;
for (let i = 0; i < 100; i++) {
  try { url = new URL(JSON.parse(await readFile(path.join(data, 'instance.json'), 'utf8')).url); break; } catch { }
  if (child && child.exitCode !== null) throw new Error('Server exited: ' + errors);
  await new Promise(r => setTimeout(r, 100));
}
assert.ok(url, 'Server started');
const key = url.hash.slice(1), origin = url.origin;
async function api(route, method = 'GET', body) {
  const r = await fetch(origin + '/api' + route, { method, headers: {'X-Session': key, 'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(r.ok, method + ' ' + route + ': ' + await (r.ok ? Promise.resolve('') : r.text()));
  return r.status === 204 ? null : r.json();
}
try {
  const html = await (await fetch(origin + '/')).text();
  assert.ok(html.includes('<title>Headroom</title>') && html.includes('<h1>Headroom</h1>'));
  assert.ok((await (await fetch(origin + '/vue.js')).text()).includes('Vue'));
  assert.ok(html.includes('Available across accounts'));
  assert.ok((await (await fetch(origin + '/usage-totals.js')).text()).includes('summarizeUsage'));
  assert.ok((await (await fetch(origin + '/usage-history.js')).text()).includes('forecastUsage'));
  assert.equal((await fetch(origin + '/api/history')).status, 401);
  assert.equal((await fetch(origin + '/api/accounts')).status, 401);
  assert.equal((await fetch(origin + '/api/accounts', {headers:{'X-Session':key, Origin:'https://example.org'}})).status, 403);
  console.log('PASS embedded Vue assets and local API authentication');
  let state = await api('/accounts');
  assert.equal(state.accounts.length, 7);
  const history = await api('/history');
  assert.equal(history.accounts.length,7);
  assert.ok(history.accounts.every(a=>a.tokens.days===null && a.points.length===0));
  console.log('PASS authenticated history endpoint preserves unknown and empty history for isolated profiles');
  const first = state.accounts[0];
  assert.equal(first.name, 'test0@example.com · Workspace 0');
  assert.equal((await fetch(origin + '/api/accounts/' + first.id, {method:'PUT', headers:{'X-Session':key,'Content-Type':'application/json'},body:JSON.stringify({name:'Manual name'})})).status,405);
  console.log('PASS seven saved profiles, calculated workspace names, and no rename endpoint');
  const login = await api('/accounts/login', 'POST', {deviceCode:false});
  assert.ok(login.url.startsWith('https://'));
  assert.equal((await api('/accounts')).accounts.length,8);
  assert.equal((await fetch(origin + '/api/accounts/login', {method:'POST', headers:{'X-Session':key,'Content-Type':'application/json'},body:'{}'})).status,400);
  await api('/login/cancel', 'POST');
  for (let i = 0; i < 50; i++) { state = await api('/accounts'); if (!state.login && !state.accounts[0].busy) break; await new Promise(r=>setTimeout(r,100)); }
  assert.equal(state.login, null);
  assert.equal(state.accounts.length,7);
  console.log('PASS direct account sign-in, concurrent request rejection, and cancellation cleanup');
  await api('/accounts/' + first.id, 'DELETE');
  assert.equal((await api('/accounts')).accounts.length, 6);
  await api('/refresh', 'POST');
  state = await api('/accounts');
  assert.ok(state.accounts.every(a=>!a.busy && a.updatedAt && !a.signedIn), 'Signed-out refresh');
  console.log('PASS remove account and refresh six isolated profiles');
  const saved = JSON.parse(await readFile(path.join(data,'accounts.json'),'utf8'));
  assert.equal(saved.length,6);
  console.log('PASS persisted account list');
  const bytes = await readFile(exe);
  const pe = bytes.readUInt32LE(0x3c), opt = pe + 24;
  assert.equal(bytes.readUInt16LE(opt), 0x20b);
  assert.equal(bytes.readUInt16LE(opt+68), 2, 'Windows GUI executable');
  assert.equal(bytes.readUInt32LE(opt+112+14*8), 0, 'Native PE has no CLR header');
  console.log('PASS x64 GUI Native AOT executable (no CLR header)');
} finally {
  await api('/quit','POST').catch(()=>{});
  const code = await Promise.race([done,new Promise(r=>setTimeout(()=>r('timeout'),12000))]);
  if(code === 'timeout') { child.kill(); throw new Error('Shutdown timed out'); }
  assert.equal(code,0);
  console.log('PASS clean shutdown');
}
