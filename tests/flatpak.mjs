// Installed-bundle checks; fixtures stay under this Flatpak's private data tree.
import {spawn,spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir,mkdtemp,copyFile,cp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
assert.equal(process.platform,'linux');
process.umask(0o077);
const id='io.github.jasonunbrokensoftware.Headroom';
const parent=path.join(os.homedir(),'.var/app',id,'data');
await mkdir(parent,{recursive:true});
const root=await mkdtemp(path.join(parent,'release-test-'));
const app=path.join(root,'headroom'),data=path.join(app,'data');
await mkdir(data,{recursive:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let child,done,url,errors;
async function api(route,method='GET',body) {
  const response=await fetch(url.origin+'/api'+route,{method,headers:{'X-Session':url.hash.slice(1),'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  assert.ok(response.ok,route+' '+response.status);
  return response.status===204?null:response.json();
}
async function start() {
  errors='';url=null;
  // Flatpak reserves XDG_DATA_HOME during setup; env overrides it only for this
  // test process after the sandbox has been created. No launcher script is used.
  child=spawn('flatpak',['run','--command=env',id,'XDG_DATA_HOME='+root,'/app/bin/Headroom','--headless'],{stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',b=>errors+=b);
  done=new Promise(r=>child.once('exit',r));
  for(let i=0;i<150;i++){
    try{url=new URL(JSON.parse(await readFile(path.join(data,'instance.json'),'utf8')).url);await api('/about');break;}catch{}
    assert.equal(child.exitCode,null,errors);await delay(100);
  }
  assert.ok(url,'Flatpak backend starts');
  assert.equal((await api('/about')).version,'1.1.0');
}
async function stop() {
  if(!child)return;
  if(child.exitCode===null&&url)await api('/quit','POST').catch(()=>{});
  const timer=setTimeout(()=>child.kill(),12000);
  const code=await done;clearTimeout(timer);child=null;
  assert.equal(code,0,errors);
}
try {
  await writeFile(path.join(data,'accounts.json'),JSON.stringify(Array.from({length:7},(_,i)=>({id:randomUUID().replaceAll('-',''),
    email:`test${i}@example.com`,workspaceName:`Workspace ${i}`,workspaceId:`workspace-${i}`,plan:'business'}))));
  await start();
  await api('/appearance','POST',{theme:'orchard'});
  assert.equal(JSON.parse(await readFile(path.join(app,'settings.json'),'utf8')).theme,'orchard');
  const location=spawnSync('flatpak',['info','--show-location',id],{encoding:'utf8'});
  assert.equal(location.status,0,location.stderr);
  process.env.HEADROOM_TEST_EXE=path.join(location.stdout.trim(),'files/bin/Headroom');
  process.env.HEADROOM_TEST_DATA=data;
  await import('./backend.mjs');
  await stop();
  await start();
  assert.equal((await api('/appearance')).theme,'orchard');
  assert.equal((await api('/accounts')).accounts.length,6);
  await stop();
  console.log('PASS Flatpak private settings, account persistence, restart and host Codex integration');
  if(process.env.HEADROOM_TEST_PORTABLE){
    const source=path.resolve(process.env.HEADROOM_TEST_PORTABLE);
    const accounts=JSON.parse(await readFile(path.join(source,'data/accounts.json'),'utf8'));
    await copyFile(path.join(source,'data/accounts.json'),path.join(data,'accounts.json'));
    for(const account of accounts){
      assert.match(account.id,/^[a-f0-9]{32}$/);
      const target=path.join(data,'accounts',account.id);await mkdir(target,{recursive:true});
      for(const file of ['auth.json','config.toml'])await copyFile(path.join(source,'data/accounts',account.id,file),path.join(target,file));
    }
    await cp(path.join(source,'data/history'),path.join(data,'history'),{recursive:true});
    await start();
    let state;
    for(let i=0;i<240;i++){
      state=await api('/accounts');
      if(state.accounts.every(a=>!a.busy&&a.updatedAt))break;
      await delay(250);
    }
    assert.equal(state.accounts.length,accounts.length);
    assert.ok(state.accounts.every(a=>a.signedIn&&a.usage&&!a.error),'Copied portable accounts return live usage in the sandbox');
    const history=await api('/history');
    assert.equal(history.accounts.length,accounts.length);
    assert.ok(history.accounts.every(a=>a.points.length>0));
    console.log(`PASS Flatpak portable import: ${accounts.length} signed-in accounts with current usage and saved history`);
    await stop();
  }
} finally {
  await stop();
  assert.ok(root.startsWith(parent+path.sep+'release-test-'));
  await rm(root,{recursive:true,force:true});
}
