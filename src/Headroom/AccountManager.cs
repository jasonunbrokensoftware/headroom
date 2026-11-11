using System.Text.Json;

namespace Headroom;

internal sealed class AccountManager : IAsyncDisposable
{
    private sealed class Entry(AccountConfig config)
    {
        public AccountConfig Config = config;
        public bool SigningUp;
        public AccountView View = new(config.Id, AccountIdentity.Name(config), config.Email, AccountIdentity.Workspace(config),
            config.WorkspaceId, config.Plan, false, false, null, null, null);
        public readonly SemaphoreSlim Gate = new(1, 1);
    }
    private sealed record PendingLogin(Entry Entry, CodexRpc Rpc, string LoginId, LoginInfo Info, bool NewAccount);
    private readonly object sync = new();
    private readonly Dictionary<string, Entry> entries = [];
    private readonly SemaphoreSlim workers = new(4, 4);
    private readonly SemaphoreSlim loginGate = new(1, 1);
    private readonly string directory;
    private PendingLogin? login;
    private Task? loginTask;
    private bool stopping;
    public AccountManager(string directory)
    {
        this.directory = directory;
        Directory.CreateDirectory(directory);
        string path = Path.Combine(directory, "accounts.json");
        if (File.Exists(path))
            foreach (var config in JsonSerializer.Deserialize(File.ReadAllText(path), AppJson.Default.ListAccountConfig) ?? [])
            {
                if (!Guid.TryParseExact(config.Id, "N", out _)) throw new InvalidDataException("Invalid saved account ID.");
                entries.Add(config.Id, new(config));
            }
    }
    private string Home(Entry e) => Path.Combine(directory, "accounts", e.Config.Id);
    private Entry Find(string id) { lock (sync) return entries.TryGetValue(id, out var e) ? e : throw new KeyNotFoundException("Account not found."); }
    private void Save()
    {
        string path = Path.Combine(directory, "accounts.json");
        File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(entries.Values.Select(e => e.Config).ToList(), AppJson.Default.ListAccountConfig));
        File.Move(path + ".tmp", path, true);
    }
    public DashboardView Snapshot() { lock (sync) return new(entries.Values.Select(e => e.View).ToList(), login?.Info); }
    internal AccountView Add(bool signingUp = false)
    {
        lock (sync)
        {
            var e = new Entry(new(Guid.NewGuid().ToString("N"))) { SigningUp = signingUp };
            entries.Add(e.Config.Id, e);
            Save();
            return e.View;
        }
    }
    public async Task<LoginInfo> AddAndLoginAsync(bool device)
    {
        if (!await loginGate.WaitAsync(0)) throw new InvalidOperationException("Complete or cancel the current sign-in first.");
        Entry entry;
        try { entry = Find(Add(signingUp: true).Id); }
        catch { loginGate.Release(); throw; }
        return await StartLoginAsync(entry, device, true);
    }
    public async Task RemoveAsync(string id)
    {
        var e = Find(id);
        if (!await e.Gate.WaitAsync(0)) throw new InvalidOperationException("Complete sign-in or wait for refresh before removing this account.");
        try
        {
            // Only this utility's isolated login is signed out.
            await using var rpc = await CodexRpc.StartAsync(Home(e), migrateCredentials: false);
            await rpc.CallAsync("account/logout");
            lock (sync) { entries.Remove(id); Save(); }
        }
        finally { e.Gate.Release(); }
    }
    public async Task RefreshAllAsync()
    {
        List<Entry> all;
        lock (sync) all = entries.Values.ToList();
        await Task.WhenAll(all.Select(RefreshEntryAsync));
    }
    public Task RefreshAsync(string id) => RefreshEntryAsync(Find(id));
    private async Task RefreshEntryAsync(Entry e)
    {
        if (stopping || !await e.Gate.WaitAsync(0)) return;
        lock (sync)
        {
            if (!entries.ContainsKey(e.Config.Id) || e.SigningUp) { e.Gate.Release(); return; }
        }
        lock (sync) e.View = e.View with { Busy = true, Error = null };
        try
        {
            await workers.WaitAsync();
            try
            {
                await using var rpc = await CodexRpc.StartAsync(Home(e));
                var result = await rpc.CallAsync("account/read", """{"refreshToken":false}""");
                var identity = AccountIdentity.Parse(e.Config.Id, result);
                bool signedIn = result.Field("account").Field("type").Text() == "chatgpt";
                lock (sync)
                {
                    bool sameAccount = e.Config.Email == identity.Email && e.Config.WorkspaceId == identity.WorkspaceId &&
                        e.Config.WorkspaceName == identity.WorkspaceName;
                    if (signedIn && e.Config != identity) { e.Config = identity; Save(); }
                    e.View = e.View with { Name = AccountIdentity.Name(e.Config), Email = e.Config.Email,
                        Workspace = AccountIdentity.Workspace(e.Config), WorkspaceId = e.Config.WorkspaceId, Plan = e.Config.Plan,
                        SignedIn = signedIn, Usage = sameAccount && signedIn ? e.View.Usage : null,
                        UpdatedAt = sameAccount && signedIn ? e.View.UpdatedAt : null };
                }
                var usage = signedIn ? UsageParser.Parse(await rpc.CallAsync("account/rateLimits/read")) : null;
                lock (sync) e.View = e.View with { Usage = usage, UpdatedAt = DateTimeOffset.UtcNow };
            }
            finally { workers.Release(); }
        }
        catch (Exception ex) { lock (sync) e.View = e.View with { Error = ex.Message }; }
        finally
        {
            lock (sync) e.View = e.View with { Busy = false };
            e.Gate.Release();
        }
    }
    public async Task<LoginInfo> LoginAsync(string id, bool device)
    {
        var e = Find(id);
        if (!await loginGate.WaitAsync(0)) throw new InvalidOperationException("Complete or cancel the current sign-in first.");
        return await StartLoginAsync(e, device, false);
    }
    private async Task<LoginInfo> StartLoginAsync(Entry e, bool device, bool newAccount)
    {
        CodexRpc? rpc = null;
        bool acquired = false;
        try
        {
            if (!await e.Gate.WaitAsync(0)) throw new InvalidOperationException("This account is refreshing. Try again in a moment.");
            acquired = true;
            lock (sync) e.View = e.View with { Busy = true, Error = null };
            rpc = await CodexRpc.StartAsync(Home(e), migrateCredentials: false);
            var result = await rpc.CallAsync("account/login/start", device ? """{"type":"chatgptDeviceCode"}""" : """{"type":"chatgpt"}""");
            string url = result.Field("authUrl").Text() ?? result.Field("verificationUrl").Text() ?? throw new InvalidDataException("No sign-in URL returned.");
            var info = new LoginInfo(e.Config.Id, url, result.Field("userCode").Text());
            var pending = new PendingLogin(e, rpc, result.Field("loginId").Text() ?? "", info, newAccount);
            lock (sync) login = pending;
            loginTask = FinishLoginAsync(pending);
            return info;
        }
        catch
        {
            if (rpc is not null) await rpc.DisposeAsync();
            if (acquired) { lock (sync) e.View = e.View with { Busy = false }; e.Gate.Release(); }
            if (newAccount) { lock (sync) { entries.Remove(e.Config.Id); Save(); } }
            loginGate.Release();
            throw;
        }
    }
    private async Task FinishLoginAsync(PendingLogin pending)
    {
        bool success = false;
        try
        {
            var result = await pending.Rpc.LoginCompleted.Task.WaitAsync(TimeSpan.FromMinutes(10));
            success = result.Field("success").ValueKind == JsonValueKind.True;
            if (!success) throw new InvalidOperationException(result.Field("error").Text() ?? "Sign-in cancelled.");
        }
        catch (Exception ex) { lock (sync) pending.Entry.View = pending.Entry.View with { Error = ex is TimeoutException ? "Sign-in expired. Try again." : ex.Message }; }
        finally
        {
            await pending.Rpc.DisposeAsync();
            lock (sync)
            {
                if (login == pending) login = null;
                pending.Entry.SigningUp = false;
                pending.Entry.View = pending.Entry.View with { Busy = false };
                if (success) pending.Entry.View = pending.Entry.View with { Usage = null, UpdatedAt = null };
                if (!success && pending.NewAccount) { entries.Remove(pending.Entry.Config.Id); Save(); }
            }
            pending.Entry.Gate.Release(); loginGate.Release();
        }
        if (success && !stopping) await RefreshAsync(pending.Entry.Config.Id);
    }
    public async Task CancelLoginAsync()
    {
        PendingLogin? current;
        lock (sync) current = login;
        if (current is not null)
        {
            try { await current.Rpc.CallAsync("account/login/cancel", $"{{\"loginId\":{JsonFields.Quote(current.LoginId)}}}"); }
            finally { current.Rpc.LoginCompleted.TrySetResult(JsonDocument.Parse("""{"success":false,"error":"Sign-in cancelled."}""").RootElement.Clone()); }
            if (loginTask is not null) await loginTask;
        }
    }
    public async ValueTask DisposeAsync()
    {
        stopping = true;
        try { await CancelLoginAsync(); } catch { }
        if (loginTask is not null)
        {
            try { await loginTask.WaitAsync(TimeSpan.FromSeconds(8)); } catch { }
        }
    }
}
