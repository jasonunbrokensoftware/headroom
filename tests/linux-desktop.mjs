// Run with a private D-Bus session and virtual display; never the user's desktop.
import {spawn, spawnSync} from 'node:child_process';
import {copyFile, mkdir, readFile, writeFile, chmod, access} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
assert.equal(process.platform,'linux');
assert.equal(process.env.HEADROOM_ISOLATED_DESKTOP,'1','Use the isolated desktop test runner');
const directory=path.resolve(".test-data/linux desktop $test 'quoted' "+Date.now());
await mkdir(directory,{recursive:true});
const executable=path.join(directory,'Headroom');
await copyFile(process.env.HEADROOM_TEST_EXE||'artifacts/linux-native/Headroom',executable);
await chmod(executable,0o700);
const config=path.join(directory,'config'),data=path.join(directory,'desktop-data');
const env={...process.env,XDG_CONFIG_HOME:config,XDG_DATA_HOME:data};
// Exercise the installed system runtime, even when the test compositor uses
// a private development toolchain with its own shared-library search path.
delete env.LD_LIBRARY_PATH;
const install=spawnSync(executable,['--install-desktop'],{env,encoding:'utf8',timeout:10000});
assert.equal(install.status,0,install.stderr);
const launcher=await readFile(path.join(data,'applications/headroom.desktop'),'utf8');
assert.ok(launcher.includes('Terminal=false')&&launcher.includes('StartupWMClass=headroom'));
assert.ok(!launcher.includes('--background'),'Application menu opens the window');
await assert.rejects(access(path.join(config,'autostart/headroom.desktop')),'A new install does not enable autostart');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let host;
async function trayHost() {
  host=spawn(process.env.HEADROOM_TRAY_TEST_HOST,[],{env,stdio:['ignore','pipe','pipe']});
  let output=''; host.stdout.on('data',b=>output+=b);
  for(let i=0;i<100&&!output.includes('READY');i++){assert.equal(host.exitCode,null);await delay(20);}
  assert.ok(output.includes('READY'));
  return ()=>output;
}
async function run(background,withTray) {
  await writeFile(path.join(directory,'settings.json'),JSON.stringify({theme:'ember',startWithWindows:false}));
  const child=spawn(executable,['--desktop-test',...(background?['--background']:[])],{env,stdio:['ignore','pipe','pipe']});
  let errors='';child.stderr.on('data',b=>errors+=b);
  const done=new Promise(resolve=>child.on('exit',resolve));
  let origin,key;
  async function api(route,method='GET') {
    const response=await fetch(origin+'/api'+route,{method,headers:{'X-Session':key}});
    assert.ok(response.ok,route+' '+response.status);
    return response.status===204?null:response.text();
  }
  try {
    for(let i=0;i<200;i++) {
      try {const url=new URL(JSON.parse(await readFile(path.join(directory,'data/instance.json'),'utf8')).url);origin=url.origin;key=url.hash.slice(1);await api('/about');break;}catch{}
      assert.equal(child.exitCode,null,errors);await delay(30);
    }
    assert.ok(origin,'App starts');
    let flags=0,sawUnpainted=false;
    for(let i=0;i<600;i++) {
      flags=Number(await api('/window/test-state'));
      if(flags&1){sawUnpainted=true;assert.equal(flags&12,12,'Unpainted host is transparent and excluded from task switching');}
      if(flags && !(flags&1))break;
      assert.equal(child.exitCode,null,errors);await delay(25);
    }
    assert.ok(sawUnpainted,'Observed the production pre-paint state');
    assert.equal(flags&1,0,'Vue and WebKit finish startup');
    assert.equal(flags&12,0,'Temporary opacity and taskbar hints are restored');
    assert.equal(!!(flags&16),withTray,'Tray availability reflects the host');
    assert.equal(!!(flags&2),!background||!withTray,'Background uses tray only, with a window fallback when no tray exists');
    await api('/window/activate','POST');
    assert.ok(Number(await api('/window/test-state'))&2);
    if(withTray){
      await api('/window/test-action/0','POST');
      assert.equal(Number(await api('/window/test-state'))&2,0,'Close hides to tray');
      await api('/window/test-action/5','POST');
      assert.ok(Number(await api('/window/test-state'))&2,'About reopens the window');
      await api('/window/test-action/3','POST');
      const desktop=await readFile(path.join(config,'autostart/headroom.desktop'),'utf8');
      assert.ok(desktop.includes('--background')&&desktop.includes('Terminal=false'));
      assert.equal(JSON.parse(await readFile(path.join(directory,'settings.json'),'utf8')).startWithWindows,true);
      await api('/window/test-action/3','POST');
      await assert.rejects(access(path.join(config,'autostart/headroom.desktop')));
      assert.equal(JSON.parse(await readFile(path.join(directory,'settings.json'),'utf8')).startWithWindows,false);
      await api('/window/test-action/4','POST');
    } else await api('/quit','POST');
    const timeout=setTimeout(()=>child.kill(),10000);
    assert.equal(await done,0,errors);clearTimeout(timeout);
    console.log(`PASS Linux desktop: ${background?'background':'normal'} launch, paint, ${withTray?'tray, About, autostart and quit':'no-tray fallback'}`);
  } finally {
    if(child.exitCode===null){if(origin)await api('/quit','POST').catch(()=>{});const timeout=setTimeout(()=>child.kill(),3000);await done;clearTimeout(timeout);}
  }
}
try {
  const output=await trayHost();
  await run(false,true);
  await run(true,true);
  assert.ok(output().includes('REGISTERED'),'The actual indicator registers with the tray host');
  const closed=new Promise(resolve=>host.on('exit',resolve));host.kill();await closed;host=null;
  await run(true,false);
  // Exercise the generated Exec field through GIO's real desktop-entry parser.
  // A copied printf executable stands in for Headroom after the app tests finish.
  await copyFile('/usr/bin/printf',executable);
  const launchTest=path.join(directory,'launch-test.desktop');
  await writeFile(launchTest,launcher.replace(/^(Exec=.*)$/m,'$1 HEADROOM_LAUNCH_OK'));
  const launched=spawnSync('gio',['launch',launchTest],{env,encoding:'utf8',timeout:10000});
  assert.equal(launched.status,0,launched.stderr);
  assert.equal(launched.stdout,'HEADROOM_LAUNCH_OK','Launcher handles spaces, dollar signs and quotes');
  console.log('PASS Linux application launcher quoting');
} finally {host?.kill();}
