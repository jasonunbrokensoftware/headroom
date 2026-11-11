import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root = 'src/Headroom/wwwroot/';
let options, messages = [], calls = [];
const context = vm.createContext({
  createApp: value => { options = value; return { mount() {} }; },
  location:{hash:''}, sessionStorage:{getItem:()=>''}, Date, JSON, Math,
  window:{external:{sendMessage:message=>messages.push(JSON.parse(message))}}
});
vm.runInContext((await readFile(root+'app.js','utf8')).replace("import { createApp } from './vue.js';",''), context);
const app = options.data();
for (const [key,value] of Object.entries(options.methods)) app[key] = value.bind(app);
app.api = async (route,method) => { calls.push([route,method]); return route === '/accounts/login' ? {url:'https://example.org/sign-in'} : null; };
app.load = async () => {};
await app.add();
assert.deepEqual(calls,[['/accounts/login','POST'],['/login/open','POST']]);
assert.equal(app.adding,false);
assert.ok(app.login);
app.windowAction('minimize'); app.windowAction('maximize'); app.windowAction('close');
app.titleDown({button:0,detail:1,screenX:-350,screenY:120,preventDefault(){}});
app.resizeDown({button:0,screenX:900,screenY:700},'se');
assert.deepEqual(messages.map(m=>m.action),['minimize','maximize','close','drag','resize']);
assert.equal(messages[3].x,-350);
app.accounts = [{id:'1',email:'a@example.com',workspaceId:'a',workspace:'One',signedIn:true},{id:'2',email:'a@example.com',workspaceId:'b',workspace:'Two',signedIn:true}];
assert.equal(app.duplicate(app.accounts[0]),false);
app.accounts[1].workspaceId='a'; assert.equal(app.duplicate(app.accounts[0]),true);
console.log('PASS frontend one-click sign-in, window bridge, and workspace-aware duplicate checks');
// Compile the actual Vue template without starting a browser or a desktop capture.
const vueSource = await readFile(root+'vue.js','utf8');
const vue = await import('data:text/javascript;base64,'+Buffer.from(vueSource).toString('base64'));
const html = await readFile(root+'index.html','utf8');
const template = html.slice(html.indexOf('<div id="app"'),html.indexOf('<script type="module"'));
const errors=[];
try { vue.compile(template,{decodeEntities:text=>text,onError:error=>errors.push(error.message)}); }
catch (error) { console.error('Template compilation failed:', error.message); process.exit(1); }
assert.deepEqual(errors,[]);
assert.equal((html.match(/<h1>/g)||[]).length,1);
assert.ok(!html.includes('Rename') && !html.includes('new-name'));
console.log('PASS Vue template compilation and one application title');
