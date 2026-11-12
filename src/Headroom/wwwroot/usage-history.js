import { capacityPolicy, uniqueAccounts, isFresh } from './usage-totals.js';

const DAY = 86400, EARLY_WINDOW = 30 * 60, epsilon = 1e-8;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const weight = plan => Object.hasOwn(capacityPolicy.weights, plan) ? capacityPolicy.weights[plan] / capacityPolicy.referenceWeight : null;
const weekly = account => {
  const quotas = (account.usage?.quotas || []).filter(q => (q.bucketId || q.bucket || '').toLowerCase() === 'codex' && q.windowMinutes === 10080);
  return quotas.length === 1 ? quotas[0] : null;
};
const dateKey = seconds => new Date(seconds * 1000).toISOString().slice(0, 10);

export function measurePace(account, history, now) {
  const quota = weekly(account), capacity = weight(quota?.plan || account.plan);
  if (!quota || !capacity || !finite(quota.remaining)) return null;
  const since = dateKey(now / 1000 - 7 * DAY);
  const days = (history?.observedDays || []).filter(d => d.date > since && weight(d.plan));
  const seconds = days.reduce((total, day) => total + day.coveredSeconds, 0);
  const consumed = days.reduce((total, day) => total + day.consumedPercent / 100 * weight(day.plan), 0);
  if (seconds >= 6 * 3600 && consumed >= capacity / 100)
    return { rate: consumed / seconds * DAY, method: 'observed', hours: seconds / 3600 };
  // A transparent fallback until local account-wide observations cover enough time.
  // This measures the current window's average, not raw-token conversion.
  const elapsed = finite(quota.resetsAt) ? now / 1000 - (quota.resetsAt - 7 * DAY) : null;
  // A recent reset must not hide an otherwise useful pooled estimate for six hours.
  // Keep a short settling period to avoid extrapolating rounded percentages over minutes.
  if (elapsed != null && elapsed >= EARLY_WINDOW && elapsed <= 7 * DAY)
    return { rate: capacity * (1 - Math.max(0, Math.min(100, quota.remaining)) / 100) / elapsed * DAY,
      method: 'window', hours: seconds / 3600 };
  if (quota.remaining === 100) return { rate: 0, method: 'window', hours: seconds / 3600 };
  return { rate: null, method: 'learning', hours: seconds / 3600,
    waitSeconds:elapsed != null && elapsed >= 0 && elapsed < EARLY_WINDOW ? EARLY_WINDOW-elapsed : null };
}

export function simulateRunway(input, dailyRate, horizon = 30, useResets = true) {
  const accounts = input.map(a => ({...a, resets:useResets ? [...a.resets].sort((a,b)=>a-b) : []}));
  let time = 0, redemptions = 0;
  const points = [];
  const record = () => {
    const balance = accounts.reduce((sum,a)=>sum + a.balance + a.capacity * a.resets.length, 0);
    points.push({day:time,value:Math.max(0,balance)});
  };
  record();
  if (!(dailyRate > 0)) return {days:null, recovery:null, points, redemptions};
  for (let iteration = 0; iteration < 10000 && time < horizon - epsilon; iteration++) {
    for (const account of accounts) {
      account.resets = account.resets.filter(expiry=>expiry > time + epsilon);
      while (account.next <= time + epsilon) { account.balance = account.capacity; account.next += 7; }
    }
    record();
    // Spend balances with the nearest refresh or reset expiry first. Reset only
    // an exhausted account, preserving its existing allowance and other accounts.
    const candidates = accounts.filter(a => (a.availableAt <= time + epsilon && a.balance > epsilon) || (a.balance <= epsilon && a.resets.length));
    candidates.sort((a,b)=>Math.min(a.balance > epsilon ? a.next : Infinity,a.resets[0]??Infinity) - Math.min(b.balance > epsilon ? b.next : Infinity,b.resets[0]??Infinity));
    const chosen = candidates[0];
    if (!chosen) {
      const recovery = Math.min(...accounts.flatMap(a => [a.next, a.balance > epsilon ? a.availableAt : Infinity]).filter(t=>t>time+epsilon));
      return {days:time,recovery:finite(recovery)?recovery:null,points,redemptions};
    }
    if (chosen.balance <= epsilon) {
      chosen.resets.shift(); chosen.balance = chosen.capacity; chosen.next = time + 7; chosen.availableAt = time;
      redemptions++; record();
    }
    const nextEvent = Math.min(horizon, ...accounts.flatMap(a => [a.next,a.availableAt,...a.resets]).filter(t=>t>time+epsilon));
    const duration = Math.min(chosen.balance / dailyRate, nextEvent - time);
    if (!(duration > epsilon)) { chosen.balance = 0; continue; }
    chosen.balance = Math.max(0, chosen.balance - duration * dailyRate);
    time += duration; record();
  }
  return {days:time >= horizon-epsilon ? horizon : null, recovery:null, points, redemptions};
}

export function forecastUsage(accounts, histories, now, multiplier = 1, useResets = true) {
  const selected = uniqueAccounts(accounts, now), models = [], paces = [];
  let unknownResets = 0, shortWindows = false, exhausted = false;
  const result = {status:'learning',message:'Collecting account-wide readings',days:null,rate:null,hours:0,early:false,
    points:[],shortWindows:false,unknownResets:0,exhausted:false,count:selected.length};
  if (!selected.length) return result;
  for (const account of selected) {
    const quota = weekly(account), capacity = weight(quota?.plan || account.plan);
    if (!isFresh(account,now) || !quota || !capacity || !finite(quota.remaining) || (finite(quota.resetsAt) && quota.resetsAt <= now/1000))
      return {...result,status:'unavailable',message:'A current, supported weekly balance is needed for every selected account.'};
    const history = histories.find(h=>h.accountId===account.id);
    const pace = measurePace(account,history,now);
    if (!pace || pace.rate === null) return {...result,hours:pace?.hours||0,waitSeconds:pace?.waitSeconds,
      message:pace?.waitSeconds != null
        ? `The weekly window for ${account.email || account.name || 'one account'} just started. An early estimate needs 30 minutes of elapsed time.`
        : `Waiting for enough measured usage or a valid weekly reset time for ${account.email || account.name || 'one account'}.`};
    paces.push(pace);
    const balance = Math.max(0, Math.min(100,quota.remaining)) / 100 * capacity;
    exhausted ||= balance === 0;
    const short = account.usage.quotas.filter(q=>(q.bucketId||q.bucket||'').toLowerCase()==='codex' && q.windowMinutes>0 && q.windowMinutes<10080);
    shortWindows ||= short.length>0;
    let availableAt = 0;
    for (const q of short.filter(q=>q.remaining===0)) {
      if (!finite(q.resetsAt) || q.resetsAt <= now/1000) return {...result,status:'unavailable',message:'A depleted short-window limit is awaiting a confirmed refresh time.'};
      availableAt = Math.max(availableAt,(q.resetsAt-now/1000)/DAY);
    }
    if (account.usage.ordinaryUsageAllowed === false && balance>0 && !short.some(q=>q.remaining===0))
      return {...result,status:'unavailable',message:'An account is limited by the service; its weekly balance is not currently usable.'};
    const seen = new Set();
    const details = (account.usage.resets||[]).filter(r=>{
      const key=r.id || r;
      if(seen.has(key)) return false;
      seen.add(key);
      return r.resetType==='codexRateLimits' && (r.expiresAt==null || r.expiresAt>now/1000);
    });
    const count = Math.max(0,account.usage.resetCount??0);
    const resets = details.slice(0,count).map(r=>finite(r.expiresAt)?(r.expiresAt-now/1000)/DAY:Infinity);
    unknownResets += Math.max(0,count-resets.length) + (account.usage.resetCount==null?1:0);
    models.push({capacity,balance,next:finite(quota.resetsAt)?(quota.resetsAt-now/1000)/DAY:Infinity,availableAt,resets});
  }
  const rate = paces.reduce((sum,p)=>sum+p.rate,0)*multiplier;
  const base = {...result,rate,hours:Math.min(...paces.map(p=>p.hours)),early:paces.some(p=>p.method!=='observed'),shortWindows,unknownResets,exhausted};
  if (!(rate>0)) return {...base,status:'quiet',message:'No consumption pace measured yet'};
  const forecast = simulateRunway(models,rate,30,useResets);
  const faster = simulateRunway(models,rate*1.5,30,useResets);
  return {...base,...forecast,fasterDays:faster.days,status:forecast.days===null?'unavailable':forecast.days>=30?'covered':'shortage',
    message:forecast.days>=30?'No weekly shortage projected within 30 days':'Estimated first interruption at this pace'};
}

const colors = ['#aebeFF','#92ddbd','#f2c785','#d2a5f4','#87cced','#ed9db3','#b9d58b'];
export function historySeries(accounts, histories, now, days, metric) {
  const selected = uniqueAccounts(accounts,now), cutoff = now/1000-days*DAY;
  return selected.map((account,index)=>{
    const history=histories.find(h=>h.accountId===account.id);
    const points=metric==='tokens' ? (history?.tokens?.days||[]).map(d=>({at:Date.parse(d.date+'T00:00:00Z')/1000,value:d.tokens})) :
      (history?.points||[]).map(p=>({at:p.at,value:metric==='resets'?p.resets:p.remaining}));
    return {id:account.id,label:account.email||account.name,color:colors[index%colors.length],
      points:points.filter(p=>p.at>=cutoff && p.at<=now/1000)};
  });
}

export function plotHistory(series, now, days, metric) {
  const width=600,height=220,left=68,right=20,top=20,bottom=40;
  const end=now/1000,start=end-days*DAY;
  const values=series.flatMap(s=>s.points.map(p=>p.value)).filter(finite);
  const max=metric==='remaining'?100:values.reduce((max,value)=>Math.max(max,value),1);
  const x=at=>left+(at-start)/(end-start)*(width-left-right);
  const y=value=>top+(1-value/max)*(height-top-bottom);
  const lines=series.map(s=>{
    let previous=null, d='';
    const dots=[];
    for(const point of s.points) {
      if(!finite(point.value)){previous=null;continue;}
      const gap=previous===null || point.at-previous>(metric==='tokens'?DAY*1.1:1800);
      d+=`${gap?'M':'L'}${x(point.at).toFixed(2)},${y(point.value).toFixed(2)} `;
      if(metric==='tokens' || gap) dots.push({...point,x:x(point.at),y:y(point.value)});
      previous=point.at;
    }
    return {...s,d,dots};
  });
  return {width,height,left,right,top,bottom,max,lines,empty:values.length===0,
    ticks:[0,.5,1].map(f=>({value:max*f,y:y(max*f)})),
    dates:[start,(start+end)/2,end].map((at,index)=>({at,x:x(at),anchor:['start','middle','end'][index]}))};
}
