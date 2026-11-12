import assert from 'node:assert/strict';
import {measurePace,simulateRunway,forecastUsage,historySeries,plotHistory} from '../src/Headroom/wwwroot/usage-history.js';
const now=Date.parse('2026-11-11T22:00:00Z'), day=86400;
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const model=(balance,rateReset=6,resets=[])=>({capacity:1,balance,next:rateReset,availableAt:0,resets});
const account=(id,remaining=50,plan='prolite')=>({id,email:id+'@example.com',workspace:'Personal',workspaceId:id,plan,signedIn:true,updatedAt:new Date(now).toISOString(),error:null,
  usage:{quotas:[{bucketId:'codex',windowMinutes:10080,remaining,resetsAt:now/1000+3.5*day}],resetCount:0,resets:[]}});
let a=account('one');
let history={accountId:'one',observedDays:[{date:'2026-11-11',plan:'prolite',consumedPercent:6,coveredSeconds:6*3600}]};
close(measurePace(a,history,now).rate,.24);
assert.equal(measurePace(a,history,now).method,'observed');
close(measurePace(a,null,now).rate,1/7);
assert.equal(measurePace(a,null,now).method,'window');
assert.equal(measurePace(account('unused',100),null,now).rate,0);
history.observedDays[0].date='2026-10-01';
assert.equal(measurePace(a,history,now).method,'window');
console.log('PASS learned allowance pace, dated history, and explicitly early current-window fallback');

const recent=account('recent',72);
recent.usage.quotas[0].resetsAt=now/1000+7*day-4*3600;
close(measurePace(recent,null,now).rate,1.68);
assert.equal(measurePace(recent,null,now).method,'window');
assert.ok(forecastUsage([a,recent],[],now).days>0, 'A four-hour-old window no longer blocks the pooled forecast');
recent.usage.quotas[0].resetsAt=now/1000+7*day-10*60;
assert.equal(measurePace(recent,null,now).rate,null);
const waiting=forecastUsage([a,recent],[],now);
assert.equal(waiting.status,'learning'); assert.equal(waiting.waitSeconds,20*60);
assert.ok(waiting.message.includes(recent.email));
recent.usage.quotas[0].resetsAt=now/1000+7*day-30*60;
assert.equal(forecastUsage([a,recent],[],now).early,true);
assert.ok(forecastUsage([a,recent],[],now).rate>0);
recent.usage.quotas[0].resetsAt=null;
assert.equal(measurePace(recent,null,now).rate,null);
assert.equal(forecastUsage([recent],[],now).waitSeconds,null);
console.log('PASS early estimates after 30 minutes, pooled recent-reset accounts, and explicit settling waits');

close(simulateRunway([model(.5,1)],.2).days,6);
assert.equal(simulateRunway([model(.5,1)],.1).days,30);
close(simulateRunway([model(.1,6,[1])],1).days,1.1);
close(simulateRunway([model(.1,6,[.05])],1).days,.1);
close(simulateRunway([model(.1,6,[1])],1,30,false).days,.1);
const result=simulateRunway([model(.1,.5,[.4])],1);
close(result.days,1.1); // Redemption shifts the natural refill to day 7.1, not day 0.5.
assert.equal(result.redemptions,1);
close(simulateRunway([model(.2,6),model(.3,6)],1).days,.5);
assert.equal(simulateRunway([model(.5,.5)],1).days,1.5); // Exact boundary refill happens before exhaustion.
assert.equal(simulateRunway([model(0,2)],.1).days,0);
console.log('PASS scheduled refills, existing resets, expiry, shifted refresh dates, account switching, and exact boundaries');

let forecast=forecastUsage([a],[],now);
assert.equal(forecast.early,true); assert.ok(forecast.rate>0);
const duplicate={...a,id:'duplicate'};
close(forecastUsage([a,duplicate],[],now).rate,forecast.rate);
assert.equal(forecastUsage([{...a,updatedAt:null}],[],now).status,'unavailable');
assert.equal(forecastUsage([account('business',50,'business')],[],now).status,'unavailable');
assert.equal(forecastUsage([account('unused',100)],[],now).status,'quiet');
a.usage.quotas.push({bucketId:'codex',windowMinutes:300,remaining:0,resetsAt:now/1000+3600});
forecast=forecastUsage([a],[],now); assert.equal(forecast.shortWindows,true); assert.equal(forecast.days,0); close(forecast.recovery,1/24);
a.usage.quotas[1].resetsAt=now/1000-1;
assert.equal(forecastUsage([a],[],now).status,'unavailable');
assert.equal(forecastUsage([account('empty',0)],[],now).days,0);
console.log('PASS duplicate accounts, unavailable readings, unknown plans, zero demand, and binding short windows');

const histories=[{accountId:'one',tokens:{days:[{date:'2026-11-07',tokens:100},{date:'2026-11-08',tokens:0},{date:'2026-11-10',tokens:200}]},
  points:[{at:now/1000-900,remaining:50,resets:1},{at:now/1000,remaining:null,resets:0}]}];
const series=historySeries([a],histories,now,7,'tokens');
const plot=plotHistory(series,now,7,'tokens');
assert.equal(series[0].points.length,3); assert.equal(series[0].points[1].value,0);
assert.equal((plot.lines[0].d.match(/M/g)||[]).length,2); // Missing day is a gap, not zero or a continuous line.
assert.equal(plot.empty,false); assert.equal(plot.max,200);
const capacity=plotHistory(historySeries([a],histories,now,7,'remaining'),now,7,'remaining');
assert.equal(capacity.lines[0].dots.length,1); assert.equal(capacity.max,100);
assert.equal(plotHistory([],now,7,'tokens').empty,true);
console.log('PASS account-wide graph data preserves real zeroes, missing days, and unknown balances');
