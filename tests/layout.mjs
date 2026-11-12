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
let savedTheme='ember', themeFailure=false;
let aboutFailure=false, aboutLinkFailure=false;
const aboutRequests=[];
const aboutFixture={version:'1.0.0',build:'1234567890abcdef1234567890abcdef12345678',copyright:'Copyright (c) 2026 Jason Carr',license:'MIT',licenseText:await readFile('LICENSE','utf8'),repositoryUrl:'https://github.com/jasonunbrokensoftware/headroom',licenseUrl:'https://github.com/jasonunbrokensoftware/headroom/blob/main/LICENSE',noticesUrl:'https://github.com/jasonunbrokensoftware/headroom/blob/main/THIRD_PARTY_NOTICES.md'};
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server = createServer(async (req,res) => {
  if(req.url==='/api/about'){res.writeHead(aboutFailure?503:200,{'Content-Type':'application/json'});res.end(JSON.stringify(aboutFailure?{text:'Test About failure'}:aboutFixture));return;}
  if(req.url.startsWith('/api/about/open/')){aboutRequests.push({path:req.url,method:req.method});res.writeHead(aboutLinkFailure?503:204,{'Content-Type':'application/json'});res.end(aboutLinkFailure?JSON.stringify({text:'Test browser failure'}):undefined);return;}
  if (req.url === '/api/accounts') {
    const send = () => { res.writeHead(state ? 200 : 503, {'Content-Type':'application/json'}); res.end(JSON.stringify(state || {text:'Test offline'})); };
    if (hold) held.push(send); else send();
    return;
  }
  if (req.url === '/api/refresh') { res.writeHead(204); res.end(); return; }
  if(req.url === '/api/appearance') {
    if(req.method==='POST') {
      const parts=[];for await(const part of req)parts.push(part);
      if(themeFailure){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({text:'Test save failure'}));return;}
      savedTheme=JSON.parse(Buffer.concat(parts)).theme;
    }
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({theme:savedTheme}));return;
  }
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
  try { let data = await readFile(file); if(req.url==='/')data=data.toString().replace('<html lang="en">',`<html lang="en" data-theme="${savedTheme}">`).replaceAll('/headroom.svg',`/headroom-${savedTheme}.svg`);res.writeHead(200, {'Content-Type':mime[path.extname(file)] || 'application/octet-stream'}); res.end(data); }
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
    window.deliverNative=message=>listener(message);
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
  assert.equal(await page.evaluate(()=>window.bridgeMessages.filter(m=>m.action==='painted').length),0,
    'Do not reveal the native window before the initial account snapshot');
  // About is usable before accounts load and through the same native tray message.
  aboutFailure=true;
  await page.getByRole('button',{name:'About Headroom',exact:true}).click();
  const aboutDialog=page.getByRole('dialog',{name:'About Headroom',exact:true});
  await aboutDialog.getByRole('alert').waitFor();
  assert.equal(await aboutDialog.locator('.about-meta').count(),0,'No invented version while metadata is unavailable');
  aboutFailure=false;
  await aboutDialog.getByRole('button',{name:'Retry',exact:true}).click();
  await aboutDialog.getByText('1.0.0',{exact:true}).waitFor();
  assert.equal(await aboutDialog.locator('code').getAttribute('title'),aboutFixture.build);
  assert.equal(await aboutDialog.locator('.about-copyright').innerText(),aboutFixture.copyright);
  for(const [name,destination] of [['Source code','source'],['MIT License','license'],['Third-party notices','notices']]){
    const link=aboutDialog.getByRole('link',{name:new RegExp(name)});
    await Promise.all([page.waitForResponse('**/api/about/open/'+destination),link.click()]);
    assert.deepEqual(aboutRequests.at(-1),{path:'/api/about/open/'+destination,method:'POST'});
  }
  aboutLinkFailure=true;
  await aboutDialog.getByRole('link',{name:/Source code/}).click();
  await aboutDialog.getByRole('textbox',{name:'Link address'}).waitFor();
  assert.equal(await aboutDialog.getByRole('textbox',{name:'Link address'}).inputValue(),aboutFixture.repositoryUrl);
  aboutLinkFailure=false;
  await aboutDialog.getByRole('button',{name:'Close',exact:true}).focus();
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(()=>!!document.activeElement.closest('.about-dialog')),'Tab focus stays in the modal');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.about-dialog[open]').count(),0);
  assert.ok(await page.locator('#about-button').evaluate(e=>e===document.activeElement),'Escape restores the launching button');
  await page.evaluate(()=>window.deliverNative('window:about'));
  await aboutDialog.waitFor();
  assert.equal(await aboutDialog.getByRole('textbox',{name:'Link address'}).count(),0);
  await aboutDialog.locator('summary').click();
  assert.equal(await aboutDialog.locator('pre').textContent(),aboutFixture.licenseText);
  for(const width of [1200,680,520]){
    await page.setViewportSize({width,height:480});
    const box=await aboutDialog.boundingBox();
    assert.ok(box.x>=15 && box.x+box.width<=width-15 && box.y>=15 && box.y+box.height<=465,'Expanded About fits the viewport');
    assert.ok(await aboutDialog.evaluate(e=>e.scrollWidth<=e.clientWidth),'License has no horizontal overflow');
  }
  await aboutDialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.setViewportSize({width:1200,height:780});
  console.log('PASS About via footer and tray bridge, accurate metadata, license, external links, retry, focus and small-window layout');
  const pending=fixture.map(a=>({...a,signedIn:false,updatedAt:null,usage:null}));
  assert.equal(await page.evaluate(()=>window.bridgeMessages.filter(m=>m.action==='painted').length),0,
    'Time passing and other painted content cannot bypass the initial account snapshot');
  state={accounts:pending,login:null};hold=false;held.splice(0).forEach(send=>send());
  await page.locator('.card').first().waitFor();
  await page.waitForFunction(()=>window.bridgeMessages.some(m=>m.action==='painted'));
  assert.ok(await page.evaluate(()=>performance.getEntriesByName('first-contentful-paint').length>0),
    'Native reveal follows a real content paint');
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
      return {dashboard:rect(document.querySelector('.dashboard')),
        header:rect(document.querySelector('.app-header')),
        headerBackground:getComputedStyle(document.querySelector('.app-header')).backgroundColor,
        appBackground:getComputedStyle(document.querySelector('#app')).backgroundColor,
        frameBorder:getComputedStyle(document.querySelector('#app')).borderTopWidth,
        headerScroll:[...document.querySelectorAll('.app-header,.header-tools,.view-nav')].map(e=>({name:e.className,overflow:getComputedStyle(e).overflowY,scroll:e.scrollHeight,client:e.clientHeight})),
        headerButtons:[...document.querySelectorAll('.app-header button')].map(rect),
        cards:[...document.querySelectorAll('.card')].map(rect),
        emails:[...document.querySelectorAll('.account-email')].map(e=>({scroll:e.scrollWidth,client:e.clientWidth,nowrap:getComputedStyle(e).whiteSpace})),
        columns:[...document.querySelectorAll('.card')].map(e=>({usage:rect(e.querySelector('.usage-body')).x,resets:rect(e.querySelector('.resets')).x})),
        overflow:document.querySelector('.content').scrollWidth>document.querySelector('.content').clientWidth,
        mainText:[...document.querySelectorAll('.panel-heading,.capacity-total,.capacity-breakdown,.runway-bottom')].map(e=>({class:e.className,scroll:e.scrollWidth,client:e.clientWidth})),
        headingCount:document.querySelectorAll('h1').length};
    });
    assert.equal(geometry.overflow,false,`No horizontal overflow at ${width}`);
    assert.equal(geometry.headerBackground,geometry.appBackground,'Header blends into the app background');
    assert.equal(geometry.frameBorder,'0px','No competing CSS outline at native rounded corners');
    for(const item of geometry.headerScroll){assert.ok(!['scroll','auto'].includes(item.overflow),`No header scroll container at ${width}: ${item.name}`);assert.ok(item.scroll<=item.client,`No header vertical overflow at ${width}: ${JSON.stringify(item)}`);}
    for(const [i,a] of geometry.headerButtons.entries()) {
      assert.ok(a.x>=0 && a.right<=width && a.bottom<=geometry.header.bottom+1,`Header control stays inside its surface at ${width}`);
      for(const b of geometry.headerButtons.slice(i+1))assert.ok(Math.min(a.right,b.right)-Math.max(a.x,b.x)<=1 || Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)<=1,`Header controls do not overlap at ${width}`);
    }
    assert.equal(geometry.headingCount,1);
    for(const email of geometry.emails){assert.equal(email.nowrap,'nowrap');assert.ok(email.scroll<=email.client,`Long email fits at ${width}: ${JSON.stringify(email)}`);}
    for(const text of geometry.mainText)assert.ok(text.scroll<=text.client+1,`Hero content fits at ${width}: ${JSON.stringify(text)}`);
    for(const columns of geometry.columns){assert.equal(columns.usage,geometry.columns[0].usage);assert.equal(columns.resets,geometry.columns[0].resets);}
    assert.ok(geometry.cards.every(r=>Math.abs(r.x-geometry.cards[0].x)<1 && Math.abs(r.width-geometry.cards[0].width)<1));
    if(width===1200)console.log(`INFO 1200x780: last account bottom ${Math.round(geometry.cards.at(-1).bottom)}px`);
    console.log(`PASS ${width}px: unified header without scrollbars or overlap, aligned rows, and unclipped summary`);
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
  const themeNames=['Ember','Orchard','Lagoon','Classic','Graphite','Rosewood'];
  const themeBackgrounds=new Set();
  const iconColors=new Set();
  for(const name of themeNames){
    const before=await page.evaluate(()=>window.bridgeMessages.length);
    await page.getByRole('button',{name:'Color theme',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.bridgeMessages.length),before,'Theme control does not initiate a window drag');
    await page.locator('.theme-option').filter({hasText:name}).click();
    await page.locator('.theme-save').filter({hasText:'Your choice is saved automatically.'}).waitFor();
    assert.equal(await page.locator('html').getAttribute('data-theme'),name.toLowerCase());
    const iconPath='/headroom-'+name.toLowerCase()+'.svg';
    assert.equal(await page.locator('.app-mark').getAttribute('src'),iconPath);
    assert.equal(await page.locator('link[rel=icon]').getAttribute('href'),iconPath);
    const pixels=await page.locator('.app-mark').evaluate(async img=>{
      await img.decode();
      const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
      const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,64,64);
      return {tile:[...ctx.getImageData(32,12,1,1).data],ink:[...ctx.getImageData(20,24,1,1).data],corner:[...ctx.getImageData(0,0,1,1).data]};
    });
    assert.equal(pixels.tile[3],255);assert.equal(pixels.ink[3],255);assert.equal(pixels.corner[3],0);
    assert.ok(pixels.tile[0]+pixels.tile[1]+pixels.tile[2]>pixels.ink[0]+pixels.ink[1]+pixels.ink[2],'The icon mark stays darker than its tile');
    if(name==='Graphite')assert.ok(pixels.tile[0]===pixels.tile[1] && pixels.tile[1]===pixels.tile[2],'Graphite icon is neutral gray');
    iconColors.add(pixels.tile.join(','));
    const colors=await page.evaluate(()=>{
      const probe=document.createElement('span');document.body.append(probe);
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
      const value=token=>{probe.style.color=`var(--${token})`;return getComputedStyle(probe).color;};
      const lum=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const rgb=[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
      const contrast=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
      const pairs=[['text','bg'],['muted','panel'],['muted','raised'],['muted','selected-bg'],['accent','panel'],['accent-ink','accent'],['green','risk-start'],['amber','panel']];
      const checks=pairs.map(([a,b])=>({pair:a+'/'+b,ratio:contrast(value(a),value(b))}));
      const chart=[...document.querySelectorAll('.history-line')].map(e=>contrast(e.getAttribute('stroke'),value('panel')));
      const background=value('bg');probe.remove();return {checks,chart,background};
    });
    themeBackgrounds.add(colors.background);
    for(const check of colors.checks)assert.ok(check.ratio>=4.5,`${name} readable text ${check.pair}: ${check.ratio}`);
    assert.ok(colors.chart.every(ratio=>ratio>=3),`${name} graph colors contrast with their surface`);
    for(const width of [1200,680,520]){
      await page.setViewportSize({width,height:480});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const box=await page.locator('.theme-menu').boundingBox();
      assert.ok(box.x>=11 && box.x+box.width<=width-11 && box.y>=0 && box.y+box.height<=469,`${name} chooser fits ${width}x480`);
      assert.equal(await page.locator('.content').evaluate(e=>e.scrollWidth>e.clientWidth),false);
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.theme-menu').count(),0);
    assert.ok(await page.getByRole('button',{name:'Color theme',exact:true}).evaluate(e=>e===document.activeElement));
    await page.setViewportSize({width:1200,height:780});
  }
  assert.equal(themeBackgrounds.size,themeNames.length,'Themes change the full surface palette, not just the accent');
  assert.equal(iconColors.size,themeNames.length,'Each theme has a distinct matching icon');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('.runway-value').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'rosewood','Saved theme is present on initial HTML after reload');
  assert.equal(await page.locator('.app-mark').getAttribute('src'),'/headroom-rosewood.svg');
  themeFailure=true;
  await page.getByRole('button',{name:'Color theme',exact:true}).click();
  await page.locator('.theme-option').filter({hasText:'Ember'}).click();
  await page.locator('.theme-save.failed').waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'rosewood','Failed save restores previous theme');
  assert.equal(await page.locator('.app-mark').getAttribute('src'),'/headroom-rosewood.svg','Failed save restores the icon');
  assert.equal(await page.locator('link[rel=icon]').getAttribute('href'),'/headroom-rosewood.svg');
  themeFailure=false;await page.keyboard.press('Escape');
  await page.locator('.brand').dispatchEvent('mousedown',{button:0,detail:1,screenX:120,screenY:30});
  assert.equal(await page.evaluate(()=>window.bridgeMessages.at(-1).action),'drag');
  await page.evaluate(()=>window.deliverNative('window:maximized'));
  assert.equal(await page.locator('.resize-edge').count(),0);
  await page.evaluate(()=>window.deliverNative('window:restored'));
  assert.equal(await page.locator('.resize-edge').count(),8);
  console.log('PASS six full palettes, text/chart contrast, portable-theme reload, save failure, bounded chooser, and window gestures');
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
  assert.equal(await page.evaluate(()=>window.bridgeMessages.filter(m=>m.action==='painted').length),1,
    'Polling, theme changes and navigation never request another startup reveal');
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
  await page.waitForFunction(()=>window.bridgeMessages.some(m=>m.action==='painted'));
  assert.equal(await page.locator('.empty,.metric-value,.startup').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS multiple quotas, unknown balances, sign-in recovery, empty accounts, connection errors, and window bridge');
} finally {
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
