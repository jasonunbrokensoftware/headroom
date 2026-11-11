// Relative plan capacities, not API prices or an estimate of tokens/tasks/hours.
// Published Nov 8, 2026 by OpenAI's Codex lead; reviewed Nov 11, 2026:
// https://x.com/thsottiaux/status/2119296267545419987
// Reset scope: https://help.openai.com/en/articles/20001498-how-resets-work-in-codex
export const capacityPolicy = Object.freeze({ reviewed: '2026-11-11', reference: 'Pro 100', referenceWeight: 10,
  weights: Object.freeze({ plus: 1, prolite: 10, pro: 20, promax: 50 }) });

export const isAccountLoading = account => !account.updatedAt && !account.error;
export const isFresh = (account, now) => !!(account.signedIn && account.usage && !account.error && account.updatedAt &&
  Number.isFinite(Date.parse(account.updatedAt)) && now - Date.parse(account.updatedAt) <= 90000);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const fraction = value => Math.max(0, Math.min(100, value)) / 100;
const identity = account => {
  const workspace = account.workspaceId || (account.workspace && account.workspace !== 'Workspace unavailable' ? account.workspace : null);
  return account.email && workspace ? JSON.stringify([account.email.toLowerCase(), workspace]) : account.id;
};
export function uniqueAccounts(accounts, now) {
  const unique = new Map();
  for (const account of accounts) {
    const key = identity(account), previous = unique.get(key);
    if (!previous || Number(isFresh(account, now)) > Number(isFresh(previous, now)) ||
      (isFresh(account, now) === isFresh(previous, now) && (Date.parse(account.updatedAt) || 0) > (Date.parse(previous.updatedAt) || 0)))
      unique.set(key, account);
  }
  return [...unique.values()];
}

export function summarizeUsage(accounts, now) {
  const selected = uniqueAccounts(accounts, now), rows = [];
  const result = { accounts: selected.length, duplicates: accounts.length - selected.length,
    pending: selected.filter(isAccountLoading).length, fresh: selected.filter(a => isFresh(a, now)).length,
    weekly: null, banked: null, potential: null, reporting: 0, excluded: 0,
    resetCount: null, valuedResets: 0, unvaluedResets: 0, expiredResets: 0, resetReporting: 0,
    expiresAt: null, nextReset: null, shortWindowBlocked: 0, permissionBlocked: 0,
    creditBalance: null, creditReporting: 0, unlimitedCredits: 0, rows };
  for (const account of selected) {
    const row = { id: account.id, email: account.email, plan: account.plan, weekly: null, banked: null,
      resetCount: null, valuedResets: 0, reason: null };
    rows.push(row);
    if (!isFresh(account, now)) { row.reason = isAccountLoading(account) ? 'Checking account' : 'No current usage'; result.excluded++; continue; }
    const usage = account.usage;
    const main = usage.quotas.filter(q => (q.bucketId || q.bucket || '').toLowerCase() === 'codex');
    const weekly = main.filter(q => q.windowMinutes === 10080 || (!q.windowMinutes && q.window === 'Weekly'));
    const quota = weekly.length === 1 ? weekly[0] : null;
    const plan = quota?.plan || account.plan;
    row.plan = plan;
    const weight = Object.hasOwn(capacityPolicy.weights, plan) ? capacityPolicy.weights[plan] : null;
    const resetCount = Number.isInteger(usage.resetCount) && usage.resetCount >= 0 ? usage.resetCount : null;
    let eligible = 0, expired = 0;
    const seen = new Set();
    for (const [index, reset] of (usage.resets || []).entries()) {
      const key = reset.id || index;
      if (seen.has(key)) continue;
      seen.add(key);
      if (finite(reset.expiresAt) && reset.expiresAt <= now / 1000) { expired++; continue; }
      if (reset.resetType === 'codexRateLimits') eligible++;
      if (resetCount > 0 && finite(reset.expiresAt)) result.expiresAt = Math.min(result.expiresAt ?? Infinity, reset.expiresAt);
    }
    if (resetCount !== null) {
      row.resetCount = Math.max(0, resetCount - expired);
      result.resetCount = (result.resetCount ?? 0) + row.resetCount;
      result.resetReporting++;
      eligible = Math.min(eligible, row.resetCount);
      result.expiredResets += Math.min(expired, resetCount);
    } else eligible = 0;
    // Credits stay separate; shared workspace balances cannot be summed per member.
    if (weight) {
      if (usage.creditsUnlimited) result.unlimitedCredits++;
      else if (finite(usage.creditBalance)) { result.creditBalance = (result.creditBalance ?? 0) + usage.creditBalance; result.creditReporting++; }
    }
    if (main.some(q => q.windowMinutes > 0 && q.windowMinutes < 10080 && finite(q.remaining) && q.remaining <= 0))
      result.shortWindowBlocked++;
    if (usage.ordinaryUsageAllowed === false) result.permissionBlocked++;
    if (!weight || !quota || !finite(quota.remaining) || (quota.resetsAt != null && quota.resetsAt <= now / 1000)) {
      row.reason = !weight ? 'Plan capacity not verified' : 'Weekly balance unavailable';
      result.excluded++;
      result.unvaluedResets += row.resetCount ?? 0;
      continue;
    }
    row.weekly = weight * fraction(quota.remaining) / capacityPolicy.referenceWeight;
    // A verified full reset restores UP TO one weekly allowance on that account.
    // Consume the existing allowance first; early redemption discards headroom.
    row.banked = resetCount === null || (row.resetCount > 0 && eligible === 0) ? null : weight * eligible / capacityPolicy.referenceWeight;
    row.valuedResets = eligible;
    result.weekly = (result.weekly ?? 0) + row.weekly;
    if (row.banked !== null) result.banked = (result.banked ?? 0) + row.banked;
    result.reporting++;
    result.valuedResets += eligible;
    result.unvaluedResets += Math.max(0, (row.resetCount ?? 0) - eligible);
    if (finite(quota.resetsAt)) result.nextReset = Math.min(result.nextReset ?? Infinity, quota.resetsAt);
  }
  if (result.weekly !== null && result.banked !== null) result.potential = result.weekly + result.banked;
  result.partial = result.excluded > 0 || result.unvaluedResets > 0 || result.resetReporting < selected.length;
  return result;
}
