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
let state = {accounts:fixture,login:null}, hold = true, held = [];
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server = createServer(async (req,res) => {
  if (req.url === '/api/accounts') {
    const send = () => { res.writeHead(state ? 200 : 503, {'Content-Type':'application/json'}); res.end(JSON.stringify(state || {text:'Test offline'})); };
    if (hold) held.push(send); else send();
    return;
  }
  if (req.url === '/api/refresh') { res.writeHead(204); res.end(); return; }
  const file = path.resolve(root, req.url === '/' ? 'index.html' : '.' + req.url);
  if (!file.startsWith(root + path.sep)) { res.writeHead(404); res.end(); return; }
  try { const data = await readFile(file); res.writeHead(200, {'Content-Type':mime[path.extname(file)] || 'application/octet-stream'}); res.end(data); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser = await chromium.launch({headless:true, ...(process.env.HEADROOM_BROWSER ? {executablePath:process.env.HEADROOM_BROWSER} : {})});
  const page = await browser.newPage({viewport:{width:1200,height:800}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(value => { Date.now = () => value; }, now);
  await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'domcontentloaded'});
  await page.locator('.startup').waitFor();
  assert.equal(await page.locator('.empty,.card,.metric-value').count(),0);
  assert.equal(await page.locator('.startup .skeleton').count() > 0,true);
  assert.equal(await page.getByRole('button',{name:'Sign in to another account',exact:true}).isDisabled(),true);
  const pending = fixture.map(a=>({...a,signedIn:false,updatedAt:null,usage:null}));
  state = {accounts:pending,login:null}; hold = false; held.splice(0).forEach(send=>send());
  await page.locator('.card').first().waitFor();
  assert.equal(await page.locator('.status.loading').count(),3);
  assert.equal(await page.locator('.overview .metric-value,.card .count,.quota-value').count(),0);
  assert.equal(await page.getByRole('button',{name:'Sign in',exact:true}).count(),0);
  assert.equal(await page.locator('.overview .skeleton-value').count(),3);
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.skeleton').first().evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});
  console.log('PASS initial connection and per-account loading show placeholders, never false zeroes or sign-in prompts');

  async function publish(accounts) {
    state = {accounts,login:null};
    await page.getByRole('button',{name:'Refresh all',exact:true}).click();
    await page.getByRole('button',{name:'Refresh all',exact:true}).waitFor();
  }
  await publish(fixture);
  await page.locator('.metric-primary .metric-value').waitFor();
  assert.match(await page.locator('.metric-primary .metric-value').innerText(),/3\.53/);
  assert.equal(await page.locator('.status.loading').count(),0);
  assert.equal(await page.locator('.quota-alert.visible').innerText(),'Allowance used up');
  assert.match(await page.locator('.quota-value').first().innerText(),/^0%/);
  for (const width of [2560,1200,680]) {
    await page.setViewportSize({width,height:1000});
    const layout = await page.evaluate(() => {
      const rect = el => { const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,width:r.width,height:r.height}; };
      return {sections:['.toolbar','.overview','.accounts-section','.footnote'].map(s=>rect(document.querySelector(s))),
        cards:[...document.querySelectorAll('.card')].map(rect),
        resets:[...document.querySelectorAll('.card>.resets')].map(rect),
        footers:[...document.querySelectorAll('.cardfooter')].map(rect),
        emails:[...document.querySelectorAll('.account-email')].map(e=>({scroll:e.scrollWidth,client:e.clientWidth,nowrap:getComputedStyle(e).whiteSpace})),
        overflow:document.querySelector('.content').scrollWidth > document.querySelector('.content').clientWidth};
    });
    const [first] = layout.sections;
    for (const section of layout.sections) { assert.ok(Math.abs(section.x-first.x)<1); assert.ok(Math.abs(section.right-first.right)<1); }
    assert.equal(layout.overflow,false,`No horizontal overflow at ${width}`);
    for (const email of layout.emails) { assert.equal(email.nowrap,'nowrap'); assert.ok(email.scroll<=email.client,`Email fits at ${width}: ${JSON.stringify(email)}`); }
    if (width > 760) {
      assert.ok(Math.abs(layout.cards[2].right-first.right)<1,`Cards fill the shared width at ${width}`);
      for (const key of ['cards','resets','footers']) for (const r of layout[key]) assert.ok(Math.abs(r.y-layout[key][0].y)<1,`${key} align at ${width}`);
    }
    console.log(`PASS ${width}px: common section edges, full-width account row, single-line emails, no overflow`);
  }
  await page.setViewportSize({width:1200,height:900});
  await page.locator('.reset-details summary').last().click();
  assert.equal(await page.locator('.reset-details[open] .reset').count(),2);
  const footers = await page.locator('.cardfooter').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));
  assert.ok(footers.every(top=>Math.abs(top-footers[0])<1));
  await page.locator('.methodology summary').click();
  assert.equal(await page.locator('.breakdown tbody tr').count(),3);
  console.log('PASS expanded expiration dates keep card footers aligned; calculation breakdown is available');

  const many = Array.from({length:8}, (_,i)=>({...fixture[i%3], id:`many-${i}`, workspaceId:`many-${i}`}));
  await publish(many);
  await page.setViewportSize({width:2560,height:1000});
  const manyLayout = await page.locator('.card').evaluateAll(nodes=>nodes.map(n=>({
    top:n.getBoundingClientRect().top, bottom:n.getBoundingClientRect().bottom,
    reset:n.querySelector('.resets').getBoundingClientRect().top,
    emailFits:n.querySelector('.account-email').scrollWidth<=n.querySelector('.account-email').clientWidth
  })));
  assert.equal(manyLayout.length,8);
  const rows = Map.groupBy(manyLayout, card=>Math.round(card.top));
  assert.equal(rows.size,2);
  for (const row of rows.values()) {
    assert.equal(row.length,4);
    assert.ok(row.every(card=>Math.abs(card.bottom-row[0].bottom)<1 && Math.abs(card.reset-row[0].reset)<1 && card.emailFits));
  }
  console.log('PASS eight accounts wrap into two aligned rows without truncating the long email');

  const mixed = [pending[0], {...pending[1],error:'Network timeout'}, {...pending[2],updatedAt:new Date(now).toISOString()}];
  await publish(mixed);
  assert.equal(await page.getByRole('button',{name:'Sign in',exact:true}).count(),1);
  assert.deepEqual(await page.locator('.status').allInnerTexts(),['Checking…','Unavailable','Sign in needed']);
  await publish([]);
  await page.locator('.empty').waitFor();
  assert.equal(await page.locator('.overview,.card').count(),0);
  state = null;
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('[role=alert]').waitFor();
  assert.equal(await page.locator('.empty,.metric-value,.startup').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS first-read failures, confirmed signed-out accounts, empty accounts, and connection errors stay distinct');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
