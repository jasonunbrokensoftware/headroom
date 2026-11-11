import { createApp } from './vue.js';
import { summarizeUsage, isAccountLoading } from './usage-totals.js';
import { forecastUsage, historySeries, plotHistory } from './usage-history.js';

const initial = location.hash.slice(1);
if (initial) { sessionStorage.setItem('session', initial); history.replaceState(null, '', '/'); }
const token = sessionStorage.getItem('session');

createApp({
  data: () => ({ accounts: [], login: null, error: '', connectionError: '', loaded: false, loading: true, maximized: false, trayAvailable: false, now: Date.now(), stopped: false,
    refreshing: false, adding: false, copyStatus: '', poll: null, clock: null,
    histories: [], historyLoaded: false, historyBusy: false, historyError: '', historyRevision: '', historyAt: Date.now(),
    historyAccount: 'all', historyDays: 30, historyMetric: 'remaining', paceMultiplier: 1, includeResets: true }),
  computed: { overview() { return summarizeUsage(this.accounts, this.now); },
    totalsLoading() { return !this.loaded || this.overview.pending > 0; },
    historyAccounts() { return this.historyAccount === 'all' ? this.accounts : this.accounts.filter(a => a.id === this.historyAccount); },
    forecastLoading() { return !this.historyLoaded || this.historyAccounts.some(isAccountLoading); },
    tokenHistoryLoading() { return this.historyAccounts.some(a => (a.busy || this.historyBusy) && !this.histories.find(h=>h.accountId===a.id)?.tokens?.updatedAt); },
    forecast() { return forecastUsage(this.historyAccounts, this.histories, this.now, Number(this.paceMultiplier), this.includeResets); },
    tokenPlot() { return plotHistory(historySeries(this.historyAccounts,this.histories,this.historyAt,Number(this.historyDays),'tokens'),this.historyAt,Number(this.historyDays),'tokens'); },
    balancePlot() { return plotHistory(historySeries(this.historyAccounts,this.histories,this.historyAt,Number(this.historyDays),this.historyMetric),this.historyAt,Number(this.historyDays),this.historyMetric); },
    historyWarnings() { return [...new Set(this.histories.filter(h => this.historyAccounts.some(a => a.id === h.accountId)).map(h => h.error).filter(Boolean))]; },
    projection() {
      const points=this.forecast.points, max=Math.max(1,...points.map(p=>p.value));
      return {max,d:points.map((p,i)=>`${i?'L':'M'}${(10+p.day/30*880).toFixed(2)},${(100-p.value/max*88).toFixed(2)}`).join(' ')};
    } },
  methods: {
    async api(path, method = 'GET', body) {
      const response = await fetch('/api' + path, { method, headers: { 'X-Session': token || '', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
      if (!response.ok) { const value = await response.json().catch(() => ({})); throw new Error(value.text || (response.status === 401 ? 'Launch the utility again to reconnect.' : 'Request failed.')); }
      return response.status === 204 ? null : response.json();
    },
    async load() {
      if (this.stopped) return;
      try {
        const state = await this.api('/accounts'); this.accounts = state.accounts; this.login = state.login; this.loaded = true; this.connectionError = '';
        if (this.historyAccount !== 'all' && !this.accounts.some(a=>a.id===this.historyAccount)) this.historyAccount='all';
        const revision=this.accounts.map(a=>[a.id,a.email,a.workspaceId,a.updatedAt,a.busy].join(':')).join('|');
        if (revision !== this.historyRevision || !this.historyLoaded) { this.historyRevision=revision; this.loadHistory(); }
      }
      catch (e) { this.connectionError = 'Unable to reach the monitor. ' + e.message; }
      finally { this.loading = false; }
    },
    async loadHistory() {
      if (this.historyBusy || !this.loaded || this.stopped) return;
      this.historyBusy=true;
      try { const result=await this.api('/history'); this.histories=result.accounts; this.historyAt=Date.now(); this.historyLoaded=true; this.historyError=''; }
      catch { this.historyError='History could not be loaded. Current account readings are still available.'; }
      finally { this.historyBusy=false; }
    },
    showHistory() { document.getElementById('history-heading')?.scrollIntoView({block:'start'}); },
    async action(fn) { this.error = ''; try { await fn(); await this.load(); } catch (e) { this.error = e.message; } },
    async add() { this.adding = true; await this.action(async () => { this.login = await this.api('/accounts/login', 'POST', { deviceCode: false }); this.copyStatus = ''; await this.api('/login/open', 'POST'); }); this.adding = false; },
    async remove(account) { if (confirm(`Remove ${account.name}? This signs out its dashboard connection.`)) await this.action(() => this.api('/accounts/' + account.id, 'DELETE')); },
    async signIn(account, deviceCode) { await this.action(async () => { this.login = await this.api(`/accounts/${account.id}/login`, 'POST', { deviceCode }); this.copyStatus = ''; await this.api('/login/open', 'POST'); }); },
    async cancelLogin() { await this.action(() => this.api('/login/cancel', 'POST')); },
    async openLogin() { await this.action(() => this.api('/login/open', 'POST')); },
    async copyLink() { try { await navigator.clipboard.writeText(this.login.url); this.copyStatus = 'Link copied. Paste it into the browser profile you want.'; } catch { this.copyStatus = 'Select the sign-in link above and press Ctrl+C to copy it.'; } },
    async refreshAll() { if (!this.loaded) { this.loading = true; await this.load(); return; } this.refreshing = true; await this.action(() => this.api('/refresh', 'POST')); this.refreshing = false; },
    windowAction(action, details = {}) { window.external?.sendMessage?.(JSON.stringify({ action, ...details })); },
    titleDown(event) { if (event.button !== 0) return; event.preventDefault(); this.windowAction(event.detail === 2 ? 'maximize' : 'drag', { x: Math.round(event.screenX), y: Math.round(event.screenY) }); },
    resizeDown(event, edge) { if (event.button === 0) this.windowAction('resize', { edge, x: Math.round(event.screenX), y: Math.round(event.screenY) }); },
    isStale(a) { return a.usage && (a.error || !a.updatedAt || this.now - new Date(a.updatedAt).getTime() > 90000); },
    isLoading: isAccountLoading,
    needsSignIn(a) { return !this.isLoading(a) && ((!a.signedIn && !!a.updatedAt) || /\b401\b|\bunauthorized\b|\bnot (?:logged|signed) in\b|\b(?:token|session|credentials?)\b.{0,30}\b(?:expired|invalid|revoked)\b|\b(?:expired|invalid|revoked)\b.{0,30}\b(?:token|session|credentials?)\b|\brefresh_token_(?:expired|reused|invalidated)\b|\bre-?authenticate\b/i.test(a.error || '')); },
    accountStatus(a) { return this.isLoading(a) ? 'Checking…' : a.busy ? 'Refreshing…' : this.needsSignIn(a) ? 'Sign in needed' : this.isStale(a) ? 'Stale' : a.error ? 'Unavailable' : a.usage?.ordinaryUsageAllowed === false ? 'Limit reached' : 'Connected'; },
    duplicate(a) { return a.signedIn && a.email && this.accounts.some(b => b.id !== a.id && b.signedIn && b.email?.toLowerCase() === a.email.toLowerCase() && (a.workspaceId && b.workspaceId ? a.workspaceId === b.workspaceId : a.workspace !== 'Workspace unavailable' && a.workspace === b.workspace)); },
    planName(plan) { return ({free:'Free', go:'Go', plus:'Plus', pro:'Pro 200', prolite:'Pro 100', promax:'Pro 500', team:'Team', business:'Business', enterprise:'Enterprise', ent26:'Enterprise', edu:'Edu', unknown:'Unknown plan'})[plan] || (plan || 'Unknown plan').replaceAll('_', ' '); },
    amount(value) { return value == null ? 'Unavailable' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value); },
    compact(value) { return new Intl.NumberFormat(undefined,{notation:'compact',maximumFractionDigits:1}).format(value); },
    dayLabel(seconds, utc = true) { return new Date(seconds*1000).toLocaleDateString(undefined,{month:'short',day:'numeric',timeZone:utc?'UTC':undefined}); },
    runway(days) { return days == null ? 'Learning…' : days >= 30 ? '30+ days' : days < 1 ? (days <= 0 ? 'Now' : '≈ ' + this.amount(days*24) + ' hours') : '≈ ' + this.amount(days) + ' days'; },
    historyPointTitle(line,point,metric) { return line.label + ' · ' + (metric==='tokens' ? this.dayLabel(point.at) : this.shortDate(point.at)) + ' · ' + this.amount(point.value) + (metric==='tokens'?' tokens':metric==='remaining'?'% remaining':' resets'); },
    shortDate(seconds) { return seconds == null ? 'Date unavailable' : new Date(seconds * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); },
    limitMessage(quota) { return ({rate_limit_reached: 'Allowance used up', workspace_owner_credits_depleted: 'Workspace credits exhausted', workspace_member_credits_depleted: 'Member credits exhausted', workspace_owner_usage_limit_reached: 'Workspace usage limit reached', workspace_member_usage_limit_reached: 'Member usage limit reached'})[quota.limitReached] || 'Usage is currently limited'; },
    date(seconds) { return seconds == null ? 'Reset time unknown' : new Date(seconds * 1000).toLocaleString(); },
    countdown(seconds) {
      if (seconds == null) return 'Unknown';
      let left = Math.ceil(seconds - this.now / 1000);
      if (left <= 0) return 'Due · awaiting refresh';
      const days = Math.floor(left / 86400); left %= 86400;
      const hours = Math.floor(left / 3600); left %= 3600;
      return (days ? `${days}d ` : '') + [hours, Math.floor(left / 60), left % 60].map(n => String(n).padStart(2, '0')).join(':');
    }
  },
  mounted() { document.getElementById('boot-status')?.remove(); window.external?.receiveMessage?.(message => { if (message === 'window:maximized') this.maximized = true; else if (message === 'window:restored') this.maximized = false; else if (message === 'window:tray') this.trayAvailable = true; else if (message === 'window:no-tray') this.trayAvailable = false; }); this.windowAction('ready'); this.load(); this.poll = setInterval(() => this.load(), 3000); this.clock = setInterval(() => this.now = Date.now(), 1000); document.addEventListener('visibilitychange',()=>{if(!document.hidden){this.load();this.loadHistory();}}); }
}).mount('#app');
