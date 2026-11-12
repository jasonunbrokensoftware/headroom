// Headless, isolated browser checks: no desktop automation or screen capture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.HEADROOM_PLAYWRIGHT_PATH
  ? pathToFileURL(path.join(process.env.HEADROOM_PLAYWRIGHT_PATH, 'index.mjs')).href : 'playwright');
const root = path.resolve('src/Headroom/wwwroot');
const now = Date.parse('2026-11-11T22:00:00Z'), future = now / 1000 + 86400;
const account = (id, plan, remaining, count = 0) => ({ id, email: `${id}@example.com`, name: id,
  workspace: 'Personal', workspaceId: `workspace-${id}`, plan, signedIn: true, busy: false,
  updatedAt: new Date(now).toISOString(), error: null,
  usage: { quotas: [{bucketId:'codex', bucket:'codex', window:'Weekly', windowMinutes:10080, remaining, resetsAt:future,
    limitReached:remaining === 0 ? 'rate_limit_reached' : null}], resetCount:count,
    ordinaryUsageAllowed:remaining > 0, resets:Array.from({length:count}, (_,i)=>({id:`${id}-${i}`, title:'Full reset', resetType:'codexRateLimits', expiresAt:future + i * 86400})) } });
const fixture = [account('one','pro',0), account('two','prolite',47,1), account('three','prolite',6,2)];
fixture[2].email = 'jasondavidcarr@unbrokensoftware.com'; // Width regression fixture only; no credentials are used.
let state = {accounts:fixture,login:null}, hold = true, held = [], observed = true, historyFailure = false;
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server = createServer(async (req,res) => {
  if (req.url === '/api/accounts') {
    const send = () => { res.writeHead(state ? 200 : 503, {'Content-Type':'application/json'}); res.end(JSON.stringify(state || {text:'Test offline'})); };
    if (hold) held.push(send); else send();
    return;
  }
  if (req.url === '/api/refresh') { res.writeHead(204); res.end(); return; }
  if (req.url === '/api/history') {
    if(historyFailure){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({text:'Test history offline'}));return;}
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({accounts:(state?.accounts||[]).map(a=>({accountId:a.id,identity:a.workspaceId,
      tokens:{days:[{date:'2026-11-09',tokens:120000000},{date:'2026-11-10',tokens:329300000}],updatedAt:new Date(now).toISOString()},
      points:[{at:now/1000-300,remaining:50,resets:2},{at:now/1000,remaining:47,resets:2}],
      observedDays:observed ? [{date:'2026-11-11',plan:a.plan,consumedPercent:10,coveredSeconds:36000}] : [],startedAt:now/1000-86400,error:null}))}));
    return;
  }
  const file = path.resolve(root, req.url === '/' ? 'index.html' : '.' + req.url);
  if (!file.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
  try { const data = await readFile(file); res.writeHead(200, {'Content-Type':mime[path.extname(file)] || 'application/octet-stream'}); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser = await chromium.launch({headless:true, ...(process.env.HEADROOM_BROWSER ? {executablePath:process.env.HEADROOM_BROWSER} : {})});
  const page = await browser.newPage({viewport:{width:1200,height:780}});
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.addInitScript(value=>{
    // Offset the clock to fixture time, but let it advance: Vue timestamps native
    // events and ignores bubbling handlers installed at or after that event.
    const started=performance.now();
    Date.now=()=>value+Math.floor(performance.now()-started);
    let listener;
    window.bridgeMessages=[];
    Object.defineProperty(window,'external',{value:{receiveMessage:fn=>listener=fn,sendMessage:message=>{
      window.bridgeMessages.push(JSON.parse(message));
      if(JSON.parse(message).action==='ready') queueMicrotask(()=>listener('window:tray'));
    }}});
  },now);
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
  await page.locator('.startup').waitFor();
  assert.equal(await page.locator('.empty,.card,.metric-value,.runway-value').count(),0);
  assert.ok(await page.locator('.startup .skeleton').count()>0);
  assert.ok(await page.getByRole('button',{name:'Sign in to another account',exact:true}).isDisabled());
  assert.equal(await page.getByRole('button',{name:'Hide to tray',exact:true}).count(),1);
  const pending=fixture.map(a=>({...a,signedIn:false,updatedAt:null,usage:null}));
  state={accounts:pending,login:null};hold=false;held.splice(0).forEach(send=>send());
  await page.locator('.card').first().waitFor();
  assert.equal(await page.locator('.status.loading').count(),3);
  assert.equal(await page.locator('.overview .metric-value,.card .count,.quota-value,.runway-value').count(),0);
  assert.equal(await page.getByRole('button',{name:'Sign in',exact:true}).count(),0);
  assert.equal(await page.locator('.overview .skeleton-value,.overview .skeleton-small').count(),3);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.skeleton').first().evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  console.log('PASS startup and per-account placeholders, reduced motion, and tray-aware custom title bar');
  async function publish(accounts){
    state={accounts,login:null};
    await page.getByRole('button',{name:'Refresh all',exact:true}).click();
    await page.getByRole('button',{name:'Refresh all',exact:true}).waitFor();
  }
  async function overview(){await page.getByRole('button',{name:'Overview',exact:true}).click();}
  async function activity(){await page.getByRole('button',{name:'Activity',exact:true}).click();}
  await publish(fixture);
  await page.locator('.metric-primary .metric-value').waitFor();
  await page.locator('.runway-value').waitFor();
  assert.match(await page.locator('.metric-value').innerText(),/3\.53/);
  assert.ok((await page.locator('.runway-value').innerText()).includes('days'));
  assert.equal(await page.locator('.history-section').isVisible(),false);
  assert.equal(await page.locator('.status.loading').count(),0);
  assert.equal(await page.locator('.quota-alert').innerText(),'Allowance used up');
  assert.match(await page.locator('.quota-value').first().innerText(),/^0%/);
  const overviewRunway=await page.locator('.runway-value').innerText();
  for(const width of [2560,1440,1200,1024,800,680,520]){
    await page.setViewportSize({width,height:780});
    const geometry=await page.evaluate(()=>{
      const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
      return {toolbar:rect(document.querySelector('.toolbar')),dashboard:rect(document.querySelector('.dashboard')),
        cards:[...document.querySelectorAll('.card')].map(rect),
        emails:[...document.querySelectorAll('.account-email')].map(e=>({scroll:e.scrollWidth,client:e.clientWidth,nowrap:getComputedStyle(e).whiteSpace})),
        columns:[...document.querySelectorAll('.card')].map(e=>({usage:rect(e.querySelector('.usage-body')).x,resets:rect(e.querySelector('.resets')).x})),
        overflow:document.querySelector('.content').scrollWidth>document.querySelector('.content').clientWidth,
        mainText:[...document.querySelectorAll('.panel-heading,.capacity-total,.capacity-breakdown,.runway-bottom')].map(e=>({class:e.className,scroll:e.scrollWidth,client:e.clientWidth})),
        headingCount:document.querySelectorAll('h1').length};
    });
    assert.equal(geometry.overflow,false,`No horizontal overflow at ${width}`);
    assert.ok(Math.abs(geometry.toolbar.x-geometry.dashboard.x)<1,`Toolbar left edge aligns at ${width}`);
    assert.ok(Math.abs(geometry.toolbar.right-geometry.dashboard.right)<1,`Toolbar right edge aligns at ${width}: ${JSON.stringify(geometry)}`);
    assert.equal(geometry.headingCount,1);
    for(const email of geometry.emails){assert.equal(email.nowrap,'nowrap');assert.ok(email.scroll<=email.client,`Long email fits at ${width}: ${JSON.stringify(email)}`);}
    for(const text of geometry.mainText)assert.ok(text.scroll<=text.client+1,`Hero content fits at ${width}: ${JSON.stringify(text)}`);
    for(const columns of geometry.columns){assert.equal(columns.usage,geometry.columns[0].usage);assert.equal(columns.resets,geometry.columns[0].resets);}
    assert.ok(geometry.cards.every(r=>Math.abs(r.x-geometry.cards[0].x)<1 && Math.abs(r.width-geometry.cards[0].width)<1));
    if(width===1200)console.log(`INFO 1200x780: last account bottom ${Math.round(geometry.cards.at(-1).bottom)}px`);
    console.log(`PASS ${width}px overview: aligned rows, single-line emails, shared edges, unclipped summary`);
    await activity();
    const charts=await page.locator('.chart-card').evaluateAll(cards=>cards.map(card=>{
      const svg=card.querySelector('svg'), bounds=svg.getBoundingClientRect(), note=card.querySelector('.chart-note').getBoundingClientRect();
      return {viewBox:svg.getAttribute('viewBox'),bottom:bounds.bottom,noteTop:note.top,
        labels:[...svg.querySelectorAll('text')].map(text=>{const r=text.getBoundingClientRect();return {text:text.textContent,inside:r.left>=bounds.left-1&&r.right<=bounds.right+1&&r.top>=bounds.top-1&&r.bottom<=bounds.bottom+1};})};
    }));
    for(const chart of charts){assert.ok(chart.viewBox);assert.ok(chart.noteTop>=chart.bottom+8,`Chart notes clear labels at ${width}`);for(const label of chart.labels)assert.ok(label.inside,`Chart label inside SVG at ${width}: ${label.text}`);}
    assert.equal(await page.locator('.content').evaluate(el=>el.scrollWidth>el.clientWidth),false);
    const forecast=await page.evaluate(()=>({stats:[...document.querySelectorAll('.forecast-stat')].map(e=>e.getBoundingClientRect().bottom),controls:document.querySelector('.forecast-controls').getBoundingClientRect().top}));
    assert.ok(forecast.controls>=Math.max(...forecast.stats)+16,`Forecast controls clear metrics at ${width}`);
    await overview();
  }
  await page.setViewportSize({width:1200,height:780});
  await page.locator('.reset-details summary').last().click();
  assert.equal(await page.locator('.reset-details[open] .reset').count(),2);
  await page.locator('.reset-details summary').last().click();
  await page.locator('.methodology summary').click();
  assert.equal(await page.locator('.breakdown tbody tr').count(),3);
  for(const align of await page.locator('.breakdown thead th:nth-last-child(-n+2)').evaluateAll(nodes=>nodes.map(e=>getComputedStyle(e).textAlign)))assert.equal(align,'right');
  await page.locator('.methodology summary').click();
  await page.locator('.account-actions>button').nth(1).click();
  await page.locator('.account-menu').waitFor({timeout:3000});
  assert.ok(await page.locator('.account-menu').isVisible());
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.account-menu').count(),0);
  assert.ok(await page.locator('.account-actions>button').nth(1).evaluate(e=>e===document.activeElement));
  await page.locator('.account-actions>button').last().click();
  const menuBounds=await page.locator('.account-menu').boundingBox();
  assert.ok(menuBounds.y>=40 && menuBounds.y+menuBounds.height<=780,'Last-row menu stays inside the window');
  await page.keyboard.press('Escape');
  await page.locator('.account-actions>button').nth(1).click();
  await page.getByRole('button',{name:'View activity & forecast',exact:true}).click();
  assert.equal(await page.locator('.history-controls select').first().inputValue(),'two');
  const selectedColor=await page.locator('.chart-legend i').first().evaluate(e=>e.style.background);
  await page.locator('.history-controls select').first().selectOption('all');
  assert.equal(await page.locator('.chart-legend i').nth(1).evaluate(e=>e.style.background),selectedColor);
  await page.getByLabel('Balance history metric').selectOption('resets');
  assert.equal(await page.locator('.chart-card h3').last().innerText(),'Banked resets');
  await page.locator('.forecast-controls input[type=checkbox]').uncheck();
  await page.locator('.forecast-controls input[type=checkbox]').check();
  await page.getByLabel('Usage pace',{exact:true}).selectOption('1.5');
  await overview();
  assert.equal(await page.locator('.runway-value').innerText(),overviewRunway,'Overview retains all-account recent pace independent of Activity scenarios');
  await page.getByRole('button',{name:'Explore forecast',exact:true}).click();
  await page.getByLabel('Usage pace',{exact:true}).selectOption('1');
  console.log('PASS account menus, keyboard dismissal, expiration details, stable colors, scope, and forecast scenarios');
  observed=false;
  const justReset=account('new-window','prolite',98);
  justReset.usage.quotas[0].resetsAt=now/1000+7*86400-10*60;
  await publish([justReset]);
  await page.locator('.forecast-waiting').waitFor();
  assert.match(await page.locator('.forecast-next').innerText(),/20 minutes/);
  assert.equal(await page.locator('.forecast-controls,.forecast-value,.forecast-method').count(),0);
  assert.ok((await page.locator('.forecast-panel').boundingBox()).height<250);
  const recent={...justReset,id:'four-hour-window',workspaceId:'four-hour-window',usage:{...justReset.usage,quotas:[{...justReset.usage.quotas[0],remaining:72,resetsAt:now/1000+7*86400-4*3600}]}};
  await publish([fixture[0],fixture[1],recent]);
  await page.locator('.forecast-value').waitFor();
  assert.equal(await page.locator('.forecast-status').innerText(),'Early estimate');
  await page.locator('.forecast-method summary').click();
  assert.ok(await page.locator('.projection svg').isVisible());
  assert.ok((await page.locator('.projection svg').getAttribute('viewBox')).includes('900 116'));
  observed=true;
  await overview();
  const many=Array.from({length:8},(_,i)=>({...fixture[i%3],id:`many-${i}`,workspaceId:`many-${i}`,workspace:`Project ${i}`}));
  await publish(many);
  await page.setViewportSize({width:1200,height:780});
  assert.equal(await page.locator('.card').count(),8);
  await page.getByLabel('Find an account').fill('Project 6');
  assert.equal(await page.locator('.card').count(),1);
  const totalBefore=await page.locator('.metric-value').innerText();
  await page.getByLabel('Find an account').fill('no match');
  assert.equal(await page.locator('.card').count(),0);
  assert.ok(await page.locator('.search-empty').isVisible());
  assert.equal(await page.locator('.metric-value').innerText(),totalBefore);
  await page.getByRole('button',{name:'Clear search',exact:true}).click();
  assert.equal(await page.locator('.card').count(),8);
  console.log('PASS early-estimate states, eight-account roster, search, and totals independent of account search');
  const multi={...fixture[2],usage:{...fixture[2].usage,quotas:[...fixture[2].usage.quotas,{bucket:'codex',bucketId:'codex',window:'5 hours',windowMinutes:300,remaining:80,resetsAt:future},{bucket:'other model',bucketId:'other',window:'Weekly',windowMinutes:10080,remaining:null,resetsAt:null}]}};
  await publish([fixture[0],fixture[1],multi]);
  assert.equal(await page.locator('.card').last().locator('.quota').count(),3);
  assert.match(await page.locator('.card').last().locator('.quota').last().innerText(),/Allowance unavailable/);
  const mixed=[pending[0],{...pending[1],error:'Network timeout'},{...pending[2],updatedAt:new Date(now).toISOString()}];
  await publish(mixed);
  assert.equal(await page.getByRole('button',{name:'Sign in',exact:true}).count(),1);
  assert.deepEqual(await page.locator('.status').allInnerTexts(),['Checking…','Unavailable','Sign in needed']);
  await page.getByRole('button',{name:'Hide to tray',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.bridgeMessages.at(-1).action),'close');
  await activity();
  await publish([]);
  await page.locator('.empty').waitFor();
  assert.equal(await page.locator('.overview,.card').count(),0);
  assert.equal(await page.getByRole('button',{name:'Overview',exact:true}).getAttribute('aria-current'),'page');
  state={accounts:fixture,login:null};historyFailure=true;
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('.history-unavailable').waitFor();
  assert.equal(await page.locator('.runway-loading').count(),0);
  historyFailure=false;
  await page.getByRole('button',{name:'Retry history',exact:true}).click();
  await page.locator('.runway-value').waitFor();
  console.log('PASS history failure replaces indefinite loading with an explicit, working retry');
  state=null;await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('[role=alert]').waitFor();
  assert.equal(await page.locator('.empty,.metric-value,.startup').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS multiple quotas, unknown balances, sign-in recovery, empty accounts, connection errors, and window bridge');
} finally {
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
