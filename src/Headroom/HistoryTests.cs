using System.Text.Json;

namespace Headroom;

internal static class HistoryTests
{
    internal static void Run(Action<bool, string> check)
    {
        string directory = Path.Combine(Path.GetTempPath(), "HeadroomTests", "history-" + Guid.NewGuid().ToString("N"));
        var store = new UsageHistory(directory);
        var identity = new AccountConfig("test-profile", "history@example.com", null, "workspace-one", "prolite");
        var now = DateTimeOffset.Parse("2026-11-11T00:02:00Z");
        var reset = now.AddDays(3).ToUnixTimeSeconds();
        Usage Usage(double? remaining, long? end = null, int count = 1) => new([new("codex", "Weekly", remaining, end ?? reset, null, "codex", 10080, "secondary", "prolite")], count, []);
        var points = new List<UsageObservation> {
            new(now.AddMinutes(-4).ToUnixTimeSeconds(), "prolite", Usage(50)),
            new(now.ToUnixTimeSeconds(), "prolite", Usage(46)),
            new(now.AddMinutes(1).ToUnixTimeSeconds(), "prolite", Usage(100, reset + 100)),
            new(now.AddMinutes(2).ToUnixTimeSeconds(), "prolite", Usage(90, reset + 100)),
            new(now.AddHours(1).ToUnixTimeSeconds(), "prolite", Usage(50, reset + 100)),
            new(now.AddHours(1).AddMinutes(1).ToUnixTimeSeconds(), "prolite", Usage(null, reset + 100)) };
        var days = UsageHistory.Observe(points, 0);
        check(days.Count == 2 && days[0].ConsumedPercent == 2 && days[1].ConsumedPercent == 12 && days.Sum(d => d.CoveredSeconds) == 300,
            "History splits midnight, skips refills, missing values, and long monitoring gaps");
        var exhausted = UsageHistory.Observe([new(now.ToUnixTimeSeconds(), "prolite", Usage(0)), new(now.AddMinutes(5).ToUnixTimeSeconds(), "prolite", Usage(0))], 0);
        check(exhausted.Single().CoveredSeconds == 300 && exhausted.Single().ConsumedPercent == 0,
            "Exhausted accounts retain observed time so switching accounts does not inflate pooled usage pace");
        store.Record(identity, Usage(50), now);
        store.Record(identity, Usage(50), now.AddMinutes(1));
        store.Record(identity, Usage(45), now.AddMinutes(5));
        using var first = JsonDocument.Parse("""{"summary":{"lifetimeTokens":500},"dailyUsageBuckets":[{"startDate":"2026-11-09","tokens":100},{"startDate":"2026-11-10","tokens":0}]}""");
        store.ImportTokens(identity, first.RootElement, now);
        using var correction = JsonDocument.Parse("""{"summary":{},"dailyUsageBuckets":[{"startDate":"2026-11-09","tokens":120}]}""");
        store.ImportTokens(identity, correction.RootElement, now.AddMinutes(1));
        var restored = new UsageHistory(directory).Read(identity, now.AddMinutes(5));
        check(restored.Tokens.Days?.Count == 2 && restored.Tokens.Days[0].Tokens == 120 && restored.Tokens.Days[1].Tokens == 0 && restored.Tokens.LifetimeTokens == 500,
            "Portable token history survives restart; downloads update dates without double-counting or losing zeroes");
        check(restored.ObservedDays.Sum(d => d.ConsumedPercent) == 5 && restored.ObservedDays.Sum(d => d.CoveredSeconds) == 300,
            "Allowance history survives restart and measures account-wide declines");
        check(UsageHistory.Identity(identity) == UsageHistory.Identity(identity with { Id = "another-profile", Email = "HISTORY@example.com" }) &&
            UsageHistory.Identity(identity) != UsageHistory.Identity(identity with { WorkspaceId = "other-workspace" }),
            "History follows the account and workspace, not a local profile or machine identifier");
        using var missing = JsonDocument.Parse("""{"summary":{},"dailyUsageBuckets":null}""");
        store.ImportTokens(identity, missing.RootElement, now);
        check(store.Read(identity, now).Tokens.Days?.Count == 2 && store.Read(identity, now).Error is not null,
            "Unavailable server history retains cached data and reports the gap");
    }
}
