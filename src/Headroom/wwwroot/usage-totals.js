// Sum reported percentages, never invent token counts or mix quota windows.
export function summarizeUsage(accounts, now) {
  const fresh = a => a.signedIn && a.usage && !a.error && a.updatedAt &&
    Number.isFinite(Date.parse(a.updatedAt)) && now - Date.parse(a.updatedAt) <= 90000;
  const identity = a => {
    const workspace = a.workspaceId || (a.workspace && a.workspace !== 'Workspace unavailable' ? a.workspace : null);
    return a.email && workspace ? JSON.stringify([a.email.toLowerCase(), workspace]) : a.id;
  };
  const unique = new Map();
  for (const account of accounts) {
    const key = identity(account), previous = unique.get(key);
    if (!previous || Number(!!fresh(account)) > Number(!!fresh(previous)) ||
      (!!fresh(account) === !!fresh(previous) && Date.parse(account.updatedAt || 0) > Date.parse(previous.updatedAt || 0)))
      unique.set(key, account);
  }
  const selected = [...unique.values()], groups = new Map();
  const resets = { total: null, reporting: 0, expiresAt: null };
  for (const account of selected) {
    const current = !!fresh(account), seen = new Set();
    for (const quota of account.usage?.quotas || []) {
      const key = JSON.stringify([quota.bucketId || quota.bucket, quota.windowMinutes ?? quota.slot ?? quota.window]);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!groups.has(key)) groups.set(key, { key, bucket: quota.bucket, window: quota.window,
        total: null, reporting: 0, stale: 0, due: 0, resetsAt: null });
      const group = groups.get(key);
      if (!current) { group.stale++; continue; }
      if (quota.resetsAt != null && quota.resetsAt <= now / 1000) { group.due++; continue; }
      if (!Number.isFinite(quota.remaining)) continue;
      group.total = (group.total ?? 0) + Math.max(0, Math.min(100, quota.remaining));
      group.reporting++;
      if (Number.isFinite(quota.resetsAt)) group.resetsAt = Math.min(group.resetsAt ?? Infinity, quota.resetsAt);
    }
    if (current && Number.isInteger(account.usage.resetCount) && account.usage.resetCount >= 0) {
      resets.total = (resets.total ?? 0) + account.usage.resetCount;
      resets.reporting++;
      if (account.usage.resetCount > 0) {
        for (const credit of account.usage.resets || [])
          if (Number.isFinite(credit.expiresAt) && credit.expiresAt > now / 1000)
            resets.expiresAt = Math.min(resets.expiresAt ?? Infinity, credit.expiresAt);
      }
    }
  }
  return { accounts: selected.length, duplicates: accounts.length - selected.length,
    fresh: selected.filter(fresh).length, resets,
    quotas: [...groups.values()].map(group => ({ ...group,
      total: group.total == null ? null : Math.round(group.total * 10) / 10,
      average: group.reporting ? Math.round(group.total / group.reporting * 10) / 10 : null
    })) };
}
