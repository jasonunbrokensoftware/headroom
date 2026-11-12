using System.Text.Json;

namespace Headroom;

internal static class SelfTests
{
    public static async Task<int> RunAsync(bool integration)
    {
        void Check(bool pass, string text) { if (!pass) throw new Exception(text); Console.WriteLine("PASS " + text); }
        HistoryTests.Run(Check);
        using var sample = JsonDocument.Parse("""
        {"ordinaryUsageAllowed":false,"rateLimitsByLimitId":{"codex":{"planType":"prolite","credits":{"balance":"12.5","hasCredits":true,"unlimited":false},"primary":{"usedPercent":25,"windowDurationMins":300,"resetsAt":5000},
        "secondary":{"usedPercent":100,"windowDurationMins":10080,"resetsAt":7000}},
        "extra":{"primary":{"usedPercent":null}}},"rateLimitResetCredits":{"availableCount":3,"credits":[{"id":"reset-a","resetType":"codexRateLimits","status":"available","expiresAt":9000},{"id":"reset-b","resetType":"codexRateLimits","status":"redeemed"}]}}
        """);
        var usage = UsageParser.Parse(sample.RootElement);
        Check(usage.Quotas.Count == 3 && usage.Quotas[0].Remaining == 75 && usage.Quotas[1].Window == "Weekly", "Multiple quota buckets and remaining usage");
        Check(usage.Quotas[2].Remaining is null, "Missing usage remains unknown");
        Check(usage.ResetCount == 3 && usage.Resets?.Count == 1, "Reset count independent of detail rows");
        Check(usage.Quotas[1].Plan == "prolite" && usage.Quotas[1].BucketId == "codex" && usage.Quotas[1].WindowMinutes == 10080, "Quota identity and plan retained for capacity weighting");
        Check(usage.Resets?[0].Id == "reset-a" && usage.Resets[0].ResetType == "codexRateLimits", "Only available reset details retain scope and identity");
        Check(usage.CreditBalance == 12.5 && !usage.CreditsUnlimited && usage.OrdinaryUsageAllowed == false, "Purchased credits and current usage permission remain separate");
        using var missing = JsonDocument.Parse("{}");
        Check(UsageParser.Parse(missing.RootElement).ResetCount is null, "Missing reset count is not zero");
        Check(UsageParser.Parse(missing.RootElement).CreditBalance is null && UsageParser.Parse(missing.RootElement).OrdinaryUsageAllowed is null, "Missing balance and permission remain unknown");
        using var zero = JsonDocument.Parse("""{"rateLimitResetCredits":{"availableCount":0,"credits":[]}}""");
        Check(UsageParser.Parse(zero.RootElement).ResetCount == 0, "Zero reset count preserved");
        using var identityJson = JsonDocument.Parse("""{"account":{"type":"chatgpt","email":"person@example.com","workspaceName":"Studio","planType":"business"},"workspaceRouting":{"chatgptAccountId":"workspace-123"}}""");
        var identity = AccountIdentity.Parse(Guid.NewGuid().ToString("N"), identityJson.RootElement);
        Check(AccountIdentity.Name(identity) == "person@example.com · Studio" && identity.WorkspaceId == "workspace-123", "Email and workspace determine account identity");
        Check(AccountIdentity.Workspace(identity with { WorkspaceName = null, WorkspaceId = null, Plan = "plus" }) == "Personal", "Personal workspace fallback");
        Check(AccountIdentity.Workspace(identity with { WorkspaceName = null, WorkspaceId = null }) == "Workspace unavailable", "Missing business workspace is not invented");
        Check(WindowGestures.HitTest("nw") == (13, 0) && WindowGestures.HitTest("se") == (17, 7) && WindowGestures.HitTest("bad").Windows == 0, "Cross-platform resize mapping and invalid gesture rejection");
        string folder = Path.Combine(Path.GetTempPath(), "HeadroomTests", Guid.NewGuid().ToString("N"));
        Check(PortableStorage.DataDirectory(null) == Path.Combine(AppContext.BaseDirectory, "data"), "Portable data is relative to the executable");
        string portableHome = Path.Combine(folder, "portable");
        PortableCredentials.Prepare(portableHome);
        Check(File.ReadAllText(Path.Combine(portableHome, "config.toml")).Contains("cli_auth_credentials_store = \"file\""), "New accounts use portable credential storage");
        File.WriteAllText(Path.Combine(portableHome, "config.toml"), "cli_auth_credentials_store = \"keyring\"\n# preserve this\n");
        PortableCredentials.Prepare(portableHome);
        Check(File.ReadAllText(Path.Combine(portableHome, "config.toml")) == "cli_auth_credentials_store = \"file\"\n# preserve this\n", "Credential mode migration preserves other configuration");
        if (OperatingSystem.IsWindows())
        {
            Check(SystemTray.NativeDataSize == 976, "Native tray data matches the Windows x64 shell ABI without creating a tray icon");
            uint[] rightClick = [0x204, 0x205, 0x7b];
            int modernMenus = 0, legacyMenus = 0;
            foreach (uint message in rightClick)
            {
                if (SystemTray.NotificationAction(true, message) == 2) modernMenus++;
                if (SystemTray.NotificationAction(false, message) == 2) legacyMenus++;
            }
            Check(modernMenus == 1 && legacyMenus == 1,
                "Tray right-click opens one menu with either modern or legacy shell notifications");
            Check(SystemTray.NotificationAction(true, 0x401) == 1 && SystemTray.NotificationAction(true, 0x202) == 0,
                "Modern tray keyboard activation works without duplicate legacy mouse activation");
            Check(NativeDesktop.WebViewRuntimeAvailable() == 1, "Statically linked Photino and WebView2 loader resolve the installed runtime without a window");
        }
        string iconFile = AppIcon.WindowIcon(folder);
        byte[] iconBytes = File.ReadAllBytes(iconFile);
        Check(OperatingSystem.IsWindows()
            ? iconBytes.Length > 6 && BitConverter.ToUInt16(iconBytes, 2) == 1 && BitConverter.ToUInt16(iconBytes, 4) == 10
            : iconBytes.Length > 24 && iconBytes[0] == 137 && iconBytes[1] == 80,
            "Embedded native window icon is available without external asset files");
        var iconHashes = new HashSet<string>();
        foreach (string theme in new[] { "ember", "orchard", "lagoon", "rosewood", "classic", "graphite" })
        {
            string themedFile = AppIcon.WindowIcon(folder, theme);
            byte[] themedBytes = File.ReadAllBytes(themedFile);
            iconHashes.Add(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(themedBytes)));
            Check(Path.GetFileName(themedFile).StartsWith("headroom-" + theme + "."), "Portable icon cache selects " + theme);
            if (OperatingSystem.IsWindows())
            {
                Check(BitConverter.ToUInt16(themedBytes, 4) == 10, theme + " contains all ten Windows icon sizes");
                foreach (int size in new[] { 16, 20, 24, 32, 40, 48, 64, 96, 128, 256 })
                {
                    nint handle = WindowIcon.Load(themedFile, size);
                    WindowIcon.Release(handle); // Validate native decoding without creating any window or tray item.
                }
            }
            using var png = System.Reflection.Assembly.GetExecutingAssembly().GetManifestResourceStream("brand.headroom-" + theme + ".png");
            Check(png is not null && png.ReadByte() == 137 && png.ReadByte() == 80, theme + " includes its Linux icon");
        }
        Check(iconHashes.Count == 6, "All six themed native icons are distinct");
        if (OperatingSystem.IsWindows())
        {
            string pins = Path.Combine(folder, "isolated-pins");
            Directory.CreateDirectory(pins);
            int result = NativeDesktop.TestTaskbarIcons(pins, Environment.ProcessPath!,
                AppIcon.WindowIcon(folder, "classic"), AppIcon.WindowIcon(folder, "ember"));
            Check(result == 0, "Pinned shortcut and taskbar-group icon follow repeated theme changes; other targets and launch details stay intact (stage " + result + ")");
        }
        await using (var manager = new AccountManager(folder))
        {
            for (int i = 0; i < 7; i++) manager.Add();
            Check(manager.Snapshot().Accounts.Count == 7, "More than three accounts supported");
        }
        await using (var manager = new AccountManager(folder))
            Check(manager.Snapshot().Accounts.Count == 7, "Account list survives restart");
        File.WriteAllText(Path.Combine(folder, "accounts.json"), JsonSerializer.Serialize(new List<AccountConfig> { identity }, AppJson.Default.ListAccountConfig));
        await using (var manager = new AccountManager(folder))
            Check(manager.Snapshot().Accounts.Single().Name == "person@example.com · Studio", "Calculated identity survives restart");
        File.WriteAllText(Path.Combine(folder, "accounts.json"), "[{\"id\":\"" + identity.Id + "\",\"name\":\"Old custom name\"}]");
        await using (var manager = new AccountManager(folder))
            Check(manager.Snapshot().Accounts.Single().Id == identity.Id && manager.Snapshot().Accounts.Single().Name != "Old custom name", "Existing profiles migrate without custom labels");
        if (integration)
        {
            await using var rpc = await CodexRpc.StartAsync(Path.Combine(folder, "probe"));
            var signedOut = await rpc.CallAsync("account/read", """{"refreshToken":false}""");
            Check(!signedOut.Field("account").Present(), "Isolated Codex account is signed out");
            var login = await rpc.CallAsync("account/login/start", """{"type":"chatgpt"}""");
            Check(login.Field("authUrl").Text() is not null, "Installed Codex returns a browser sign-in URL");
            await rpc.CallAsync("account/login/cancel", $"{{\"loginId\":{JsonFields.Quote(login.Field("loginId").Text()!)}}}");
            Console.WriteLine("PASS Sign-in cancellation");
            await using var manager = new AccountManager(Path.Combine(folder, "signup"));
            var pending = await manager.AddAndLoginAsync(false);
            Check(pending.Url.StartsWith("https://") && manager.Snapshot().Accounts.Count == 1, "One-step account sign-in creates a pending profile");
            bool rejected = false;
            try { await manager.AddAndLoginAsync(false); } catch (InvalidOperationException) { rejected = true; }
            Check(rejected && manager.Snapshot().Accounts.Count == 1, "Concurrent sign-ins do not leave extra profiles");
            await manager.CancelLoginAsync();
            Check(manager.Snapshot().Accounts.Count == 0 && manager.Snapshot().Login is null, "Cancelled new sign-in removes its empty card");
        }
        Console.WriteLine("All tests passed.");
        return 0;
    }
}
