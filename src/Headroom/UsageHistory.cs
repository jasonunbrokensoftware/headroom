using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Headroom;

public record TokenDay(string Date, long Tokens);
public record TokenHistory(List<TokenDay>? Days, long? LifetimeTokens, DateTimeOffset? UpdatedAt);
public record UsageObservation(long At, string? Plan, Usage Usage);
public record HistoryPoint(long At, double? Remaining, int? Resets);
public record ObservedDay(string Date, string? Plan, double ConsumedPercent, long CoveredSeconds);
public record AccountHistory(string AccountId, string Identity, TokenHistory Tokens, List<HistoryPoint> Points,
    List<ObservedDay> ObservedDays, long? StartedAt, string? Error);
public record HistoryView(List<AccountHistory> Accounts);

// Account-wide service readings, stored next to the EXE. No chat content or credentials.
internal sealed class UsageHistory(string directory)
{
    private sealed class Entry
    {
        public List<UsageObservation> Observations = [];
        public TokenHistory Tokens = new(null, null, null);
        public string? Error;
        public long LastCompacted;
        public DateTimeOffset LastTokenAttempt;
    }
    private readonly object sync = new();
    private readonly Dictionary<string, Entry> entries = [];
    private string Folder => Path.Combine(directory, "history");
    internal static string Identity(AccountConfig account) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(
        JsonSerializer.Serialize(new[] { account.Email?.ToLowerInvariant() ?? account.Id,
            account.WorkspaceId ?? AccountIdentity.Workspace(account) }, AppJson.Default.StringArray)))).ToLowerInvariant();
    private string FileFor(string key, string extension) => Path.Combine(Folder, key + extension);
    private Entry Get(string key)
    {
        if (entries.TryGetValue(key, out var found)) return found;
        var entry = new Entry();
        Directory.CreateDirectory(Folder);
        var observationsFile = FileFor(key, ".jsonl");
        if (File.Exists(observationsFile))
            foreach (string line in File.ReadLines(observationsFile))
            {
                try { if (JsonSerializer.Deserialize(line, AppJson.Default.UsageObservation) is { } point) entry.Observations.Add(point); }
                catch (JsonException) { entry.Error = "Some saved history could not be read; intact readings were kept."; }
            }
        entry.Observations = entry.Observations.OrderBy(p => p.At).DistinctBy(p => p.At).ToList();
        try
        {
            if (File.Exists(FileFor(key, ".tokens.json")))
                entry.Tokens = JsonSerializer.Deserialize(File.ReadAllText(FileFor(key, ".tokens.json")), AppJson.Default.TokenHistory) ?? entry.Tokens;
        }
        catch (JsonException) { entry.Error = "Saved token history could not be read; it will be downloaded again."; }
        entries[key] = entry;
        return entry;
    }
    internal static Quota? Weekly(Usage usage)
    {
        var quotas = usage.Quotas.Where(q => (q.BucketId ?? q.Bucket).Equals("codex", StringComparison.OrdinalIgnoreCase) && q.WindowMinutes == 10080).Take(2).ToArray();
        return quotas.Length == 1 ? quotas[0] : null;
    }
    public void Record(AccountConfig account, Usage usage, DateTimeOffset time)
    {
        lock (sync)
        {
            string key = Identity(account);
            var entry = Get(key);
            long now = time.ToUnixTimeSeconds();
            var previous = entry.Observations.LastOrDefault();
            if (previous is not null && now - previous.At < 60) return;
            if (previous is not null && now - previous.At < 300 && previous.Plan == account.Plan &&
                previous.Usage.ResetCount == usage.ResetCount && previous.Usage.CreditBalance == usage.CreditBalance &&
                previous.Usage.OrdinaryUsageAllowed == usage.OrdinaryUsageAllowed && previous.Usage.Quotas.SequenceEqual(usage.Quotas) &&
                (previous.Usage.Resets ?? []).SequenceEqual(usage.Resets ?? [])) return;
            var observation = new UsageObservation(now, account.Plan, usage);
            File.AppendAllText(FileFor(key, ".jsonl"), JsonSerializer.Serialize(observation, AppJson.Default.UsageObservation) + "\n");
            entry.Observations.Add(observation);
            if (now - entry.LastCompacted >= 86400)
            {
                // Keep 90 days; the append log makes each normal refresh a small write.
                entry.Observations.RemoveAll(p => p.At < now - 90 * 86400);
                string temporary = FileFor(key, ".jsonl.tmp");
                File.WriteAllLines(temporary, entry.Observations.Select(p => JsonSerializer.Serialize(p, AppJson.Default.UsageObservation)));
                File.Move(temporary, FileFor(key, ".jsonl"), true);
                entry.LastCompacted = now;
            }
        }
    }
    public bool NeedsTokens(AccountConfig account, DateTimeOffset now)
    {
        lock (sync)
        {
            var entry = Get(Identity(account));
            if (now - entry.LastTokenAttempt < TimeSpan.FromMinutes(15) || now - entry.Tokens.UpdatedAt < TimeSpan.FromMinutes(15)) return false;
            entry.LastTokenAttempt = now;
            return true;
        }
    }
    public void ImportTokens(AccountConfig account, JsonElement result, DateTimeOffset now)
    {
        lock (sync)
        {
            string key = Identity(account);
            var entry = Get(key);
            var days = result.Field("dailyUsageBuckets");
            List<TokenDay>? merged = entry.Tokens.Days;
            if (days.ValueKind == JsonValueKind.Array)
            {
                var map = (merged ?? []).ToDictionary(d => d.Date, d => d.Tokens);
                foreach (var day in days.EnumerateArray())
                    if (day.Field("startDate").Text() is string date && DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _) &&
                        day.Field("tokens").Number() is long tokens && tokens >= 0) map[date] = tokens;
                // Upsert, never add repeated downloads. Missing dates are not invented zeroes.
                merged = map.OrderBy(p => p.Key).TakeLast(730).Select(p => new TokenDay(p.Key, p.Value)).ToList();
            }
            entry.Tokens = new(merged, result.Field("summary").Field("lifetimeTokens").Number() ?? entry.Tokens.LifetimeTokens, now);
            string temporary = FileFor(key, ".tokens.json.tmp");
            File.WriteAllText(temporary, JsonSerializer.Serialize(entry.Tokens, AppJson.Default.TokenHistory));
            File.Move(temporary, FileFor(key, ".tokens.json"), true);
            entry.Error = days.ValueKind == JsonValueKind.Array ? null : "The service did not return daily history in its latest response.";
        }
    }
    public void SetError(AccountConfig account, string message) { lock (sync) Get(Identity(account)).Error = message; }
    public AccountHistory Read(AccountConfig account, DateTimeOffset now)
    {
        lock (sync)
        {
            string key = Identity(account);
            var entry = Get(key);
            var points = entry.Observations.Where(p => p.At >= now.ToUnixTimeSeconds() - 90 * 86400)
                .GroupBy(p => p.At / 900).Select(g => g.Last())
                .Select(p => new HistoryPoint(p.At, Weekly(p.Usage)?.Remaining, p.Usage.ResetCount)).ToList();
            return new(account.Id, key, entry.Tokens, points, Observe(entry.Observations, now.ToUnixTimeSeconds() - 30 * 86400), entry.Observations.FirstOrDefault()?.At, entry.Error);
        }
    }
    internal static List<ObservedDay> Observe(IReadOnlyList<UsageObservation> points, long since)
    {
        var result = new Dictionary<(string Date, string? Plan), (double Used, long Seconds)>();
        for (int i = 1; i < points.Count; i++)
        {
            var before = points[i - 1]; var after = points[i];
            if (before.At < since || after.At <= before.At || after.At - before.At > 600) continue;
            var a = Weekly(before.Usage); var b = Weekly(after.Usage);
            string? plan = b?.Plan ?? after.Plan;
            if (a?.Remaining is not double start || b?.Remaining is not double end || start < end ||
                a.ResetsAt is null || a.ResetsAt != b.ResetsAt || a.ResetsAt <= after.At ||
                (a.Plan ?? before.Plan) != plan || before.Usage.ResetCount != after.Usage.ResetCount) continue;
            // Include zero-use time, even on an exhausted account. Otherwise switching
            // between accounts would inflate each account's rate and double-count demand.
            long cursor = before.At;
            while (cursor < after.At)
            {
                var date = DateTimeOffset.FromUnixTimeSeconds(cursor);
                long finish = Math.Min(after.At, new DateTimeOffset(date.UtcDateTime.Date.AddDays(1), TimeSpan.Zero).ToUnixTimeSeconds());
                var key = (date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), plan);
                var current = result.GetValueOrDefault(key);
                result[key] = (current.Used + (start - end) * (finish - cursor) / (after.At - before.At), current.Seconds + finish - cursor);
                cursor = finish;
            }
        }
        return result.OrderBy(p => p.Key.Date).Select(p => new ObservedDay(p.Key.Date, p.Key.Plan, p.Value.Used, p.Value.Seconds)).ToList();
    }
}
