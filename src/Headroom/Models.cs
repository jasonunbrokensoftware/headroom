using System.Text.Json;
using System.Text.Json.Serialization;

namespace Headroom;

public record AccountConfig(string Id, string? Email = null, string? WorkspaceName = null, string? WorkspaceId = null, string? Plan = null);
public record LoginInput(bool DeviceCode = false);
public record Message(string Text);
public record InstanceInfo(string Url);
public record Quota(string Bucket, string Window, double? Remaining, long? ResetsAt, string? LimitReached,
    string? BucketId = null, long? WindowMinutes = null, string? Slot = null, string? Plan = null);
public record ResetCredit(string? Title, long? ExpiresAt, string? Id = null, string? ResetType = null);
public record Usage(List<Quota> Quotas, int? ResetCount, List<ResetCredit>? Resets,
    double? CreditBalance = null, bool CreditsUnlimited = false, bool? OrdinaryUsageAllowed = null);
public record LoginInfo(string AccountId, string Url, string? Code);
public record AccountView(string Id, string Name, string? Email, string Workspace, string? WorkspaceId, string? Plan, bool SignedIn,
    bool Busy, Usage? Usage, DateTimeOffset? UpdatedAt, string? Error);
public record DashboardView(List<AccountView> Accounts, LoginInfo? Login);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, WriteIndented = false)]
[JsonSerializable(typeof(List<AccountConfig>))]
[JsonSerializable(typeof(LoginInput))]
[JsonSerializable(typeof(Message))]
[JsonSerializable(typeof(InstanceInfo))]
[JsonSerializable(typeof(LocalSettings))]
[JsonSerializable(typeof(DashboardView))]
[JsonSerializable(typeof(AccountView))]
[JsonSerializable(typeof(LoginInfo))]
[JsonSerializable(typeof(string))]
[JsonSerializable(typeof(string[]))]
[JsonSerializable(typeof(UsageObservation))]
[JsonSerializable(typeof(TokenHistory))]
[JsonSerializable(typeof(HistoryView))]
internal partial class AppJson : JsonSerializerContext;

internal static class AccountIdentity
{
    public static AccountConfig Parse(string id, JsonElement result)
    {
        var account = result.Field("account");
        return new(id, Clean(account.Field("email").Text()), Clean(account.Field("workspaceName").Text()),
            Clean(result.Field("workspaceRouting").Field("chatgptAccountId").Text()), Clean(account.Field("planType").Text()));
    }

    public static string Workspace(AccountConfig config) => config.WorkspaceName ??
        (config.Plan is "free" or "go" or "plus" or "pro" or "prolite" or "promax" ? "Personal" :
        config.WorkspaceId is string id ? "Workspace " + id[..Math.Min(8, id.Length)] : "Workspace unavailable");
    public static string Name(AccountConfig config) => config.Email is string email
        ? email + " · " + Workspace(config) : "Sign-in pending";
    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

internal static class JsonFields
{
    public static JsonElement Field(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) ? v : default;
    public static string? Text(this JsonElement e) => e.ValueKind == JsonValueKind.String ? e.GetString() : null;
    public static long? Number(this JsonElement e) => e.ValueKind == JsonValueKind.Number && e.TryGetInt64(out var n) ? n : null;
    public static bool Present(this JsonElement e) => e.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined);
    public static string Quote(string value) => JsonSerializer.Serialize(value, AppJson.Default.String);
}

internal static class UsageParser
{
    public static Usage Parse(JsonElement result)
    {
        var quotas = new List<Quota>();
        void AddBucket(string id, JsonElement bucket)
        {
            foreach (var (field, fallback) in new[] { ("primary", "Primary"), ("secondary", "Secondary") })
            {
                var w = bucket.Field(field);
                if (!w.Present()) continue;
                var minutes = w.Field("windowDurationMins").Number();
                string window = minutes switch
                {
                    10080 => "Weekly", > 0 when minutes % 1440 == 0 => $"{minutes / 1440}-day",
                    > 0 when minutes % 60 == 0 => $"{minutes / 60}-hour", > 0 => $"{minutes}-minute", _ => fallback
                };
                double? remaining = w.Field("usedPercent").TryDouble() is double used ? Math.Clamp(100 - used, 0, 100) : null;
                quotas.Add(new(bucket.Field("limitName").Text() ?? id, window, remaining,
                    w.Field("resetsAt").Number(), bucket.Field("rateLimitReachedType").Text(), id, minutes, field, bucket.Field("planType").Text()));
            }
        }
        var buckets = result.Field("rateLimitsByLimitId");
        if (buckets.ValueKind == JsonValueKind.Object && buckets.EnumerateObject().Any())
            foreach (var bucket in buckets.EnumerateObject()) AddBucket(bucket.Name, bucket.Value);
        else if (result.Field("rateLimits") is var bucket && bucket.Present())
            AddBucket(bucket.Field("limitId").Text() ?? "codex", bucket);
        var resets = result.Field("rateLimitResetCredits");
        int? count = resets.Field("availableCount").Number() is long n ? checked((int)n) : null;
        List<ResetCredit>? credits = null;
        if (resets.Field("credits") is var details && details.ValueKind == JsonValueKind.Array)
            credits = details.EnumerateArray().Where(c => c.Field("status").Text() == "available")
                .Select(c => new ResetCredit(c.Field("title").Text(), c.Field("expiresAt").Number(),
                    c.Field("id").Text(), c.Field("resetType").Text())).ToList();
        var main = buckets.Field("codex");
        if (!main.Present()) main = result.Field("rateLimits");
        var balance = main.Field("credits");
        double? creditBalance = double.TryParse(balance.Field("balance").Text(), System.Globalization.NumberStyles.Float,
            System.Globalization.CultureInfo.InvariantCulture, out double number) && double.IsFinite(number) && number >= 0 ? number : null;
        if (creditBalance is null && balance.Field("hasCredits").ValueKind == JsonValueKind.False) creditBalance = 0;
        bool? allowed = result.Field("ordinaryUsageAllowed").ValueKind switch { JsonValueKind.True => true, JsonValueKind.False => false, _ => null };
        return new(quotas, count, credits, creditBalance, balance.Field("unlimited").ValueKind == JsonValueKind.True, allowed);
    }

    private static double? TryDouble(this JsonElement e) => e.ValueKind == JsonValueKind.Number &&
        e.TryGetDouble(out var n) && double.IsFinite(n) ? n : null;
}
