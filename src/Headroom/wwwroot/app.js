import { createApp } from './vue.js';
import { summarizeUsage } from './usage-totals.js';

const initial = location.hash.slice(1);
if (initial) { sessionStorage.setItem('session', initial); history.replaceState(null, '', '/'); }
const token = sessionStorage.getItem('session');

createApp({
  data: () => ({ accounts: [], login: null, error: '', maximized: false, now: Date.now(), stopped: false,
    refreshing: false, adding: false, copyStatus: '', poll: null, clock: null }),
  computed: { overview() { return summarizeUsage(this.accounts, this.now); } },
  methods: {
    async api(path, method = 'GET', body) {
      const response = await fetch('/api' + path, { method, headers: { 'X-Session': token || '', 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
      if (!response.ok) { const value = await response.json().catch(() => ({})); throw new Error(value.text || (response.status === 401 ? 'Launch the utility again to reconnect.' : 'Request failed.')); }
      return response.status === 204 ? null : response.json();
    },
    async load() {
      if (this.stopped) return;
      try { const state = await this.api('/accounts'); this.accounts = state.accounts; this.login = state.login; }
      catch (e) { this.error = 'Unable to reach the monitor. ' + e.message; }
    },
    async action(fn) { this.error = ''; try { await fn(); await this.load(); } catch (e) { this.error = e.message; } },
    async add() { this.adding = true; await this.action(async () => { this.login = await this.api('/accounts/login', 'POST', { deviceCode: false }); this.copyStatus = ''; await this.api('/login/open', 'POST'); }); this.adding = false; },
    async remove(account) { if (confirm(`Remove ${account.name}? This signs out its dashboard connection.`)) await this.action(() => this.api('/accounts/' + account.id, 'DELETE')); },
    async signIn(account, deviceCode) { await this.action(async () => { this.login = await this.api(`/accounts/${account.id}/login`, 'POST', { deviceCode }); this.copyStatus = ''; await this.api('/login/open', 'POST'); }); },
    async cancelLogin() { await this.action(() => this.api('/login/cancel', 'POST')); },
    async openLogin() { await this.action(() => this.api('/login/open', 'POST')); },
    async copyLink() { try { await navigator.clipboard.writeText(this.login.url); this.copyStatus = 'Link copied. Paste it into the browser profile you want.'; } catch { this.copyStatus = 'Select the sign-in link above and press Ctrl+C to copy it.'; } },
    async refreshAll() { this.refreshing = true; await this.action(() => this.api('/refresh', 'POST')); this.refreshing = false; },
    windowAction(action, details = {}) { window.external?.sendMessage?.(JSON.stringify({ action, ...details })); },
    titleDown(event) { if (event.button !== 0) return; event.preventDefault(); this.windowAction(event.detail === 2 ? 'maximize' : 'drag', { x: Math.round(event.screenX), y: Math.round(event.screenY) }); },
    resizeDown(event, edge) { if (event.button === 0) this.windowAction('resize', { edge, x: Math.round(event.screenX), y: Math.round(event.screenY) }); },
    isStale(a) { return a.usage && (a.error || !a.updatedAt || this.now - new Date(a.updatedAt).getTime() > 90000); },
    needsSignIn(a) { return !a.signedIn || /\b401\b|\bunauthorized\b|\bnot (?:logged|signed) in\b|\b(?:token|session|credentials?)\b.{0,30}\b(?:expired|invalid|revoked)\b|\b(?:expired|invalid|revoked)\b.{0,30}\b(?:token|session|credentials?)\b|\brefresh_token_(?:expired|reused|invalidated)\b|\bre-?authenticate\b/i.test(a.error || ''); },
    duplicate(a) { return a.signedIn && a.email && this.accounts.some(b => b.id !== a.id && b.signedIn && b.email?.toLowerCase() === a.email.toLowerCase() && (a.workspaceId && b.workspaceId ? a.workspaceId === b.workspaceId : a.workspace !== 'Workspace unavailable' && a.workspace === b.workspace)); },
    planName(plan) { return ({free:'Free', go:'Go', plus:'Plus', pro:'Pro', prolite:'Pro Lite', promax:'Pro Max', team:'Team', business:'Business', enterprise:'Enterprise', ent26:'Enterprise', edu:'Edu', unknown:'Unknown plan'})[plan] || plan.replaceAll('_', ' '); },
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
  mounted() { window.external?.receiveMessage?.(message => { if (message === 'window:maximized') this.maximized = true; else if (message === 'window:restored') this.maximized = false; }); this.windowAction('ready'); this.load(); this.poll = setInterval(() => this.load(), 3000); this.clock = setInterval(() => this.now = Date.now(), 1000); }
}).mount('#app');
