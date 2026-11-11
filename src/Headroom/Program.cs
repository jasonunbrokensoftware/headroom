using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using Headroom;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

internal static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        if (args.Contains("--self-test")) return SelfTests.RunAsync(args.Contains("--integration-test")).GetAwaiter().GetResult();
        bool headless = args.Contains("--headless") || args.Contains("--no-browser");
        using var stop = new CancellationTokenSource();
        var ready = new TaskCompletionSource<DesktopStart?>(TaskCreationOptions.RunContinuationsAsynchronously);
        var desktop = new DesktopWindow();
        var backend = Task.Run(() => RunAsync(args, ready, desktop, stop.Token));
        _ = backend.ContinueWith(result =>
        {
            if (result.IsFaulted) ready.TrySetException(result.Exception!.GetBaseException());
            else ready.TrySetResult(null);
            desktop.RequestClose();
        }, TaskScheduler.Default);
        try
        {
            var startup = ready.Task.GetAwaiter().GetResult();
            if (startup is not null && !headless) desktop.Run(startup, stop.Cancel);
            return backend.GetAwaiter().GetResult();
        }
        finally
        {
            stop.Cancel();
            try { backend.GetAwaiter().GetResult(); } catch { }
        }
    }

    private static async Task<int> RunAsync(string[] args, TaskCompletionSource<DesktopStart?> ready,
        DesktopWindow desktop, CancellationToken shutdown)
    {
string? Option(string name) { int i = Array.IndexOf(args, name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
string data = Path.GetFullPath(Option("--data-dir") ?? Path.Combine(AppContext.BaseDirectory, "data"));
Directory.CreateDirectory(data);
if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(data, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
string instancePath = Path.Combine(data, "instance.json");
FileStream instanceLock;
try { instanceLock = new(Path.Combine(data, "instance.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
catch (IOException)
{
    if (!args.Contains("--headless") && !args.Contains("--no-browser"))
    {
        try
        {
            var saved = JsonSerializer.Deserialize(File.ReadAllText(instancePath), AppJson.Default.InstanceInfo);
            if (saved is not null)
            {
                var url = new Uri(saved.Url);
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
                client.DefaultRequestHeaders.Add("X-Session", url.Fragment.TrimStart('#'));
                await client.PostAsync(new Uri(url, "/api/window/activate"), null);
            }
        }
        catch { }
    }
    return 0;
}
using var heldLock = instanceLock;
await using var accounts = new AccountManager(data);
var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { Args = [], ContentRootPath = AppContext.BaseDirectory });
builder.Logging.ClearProviders();
builder.WebHost.UseUrls("http://127.0.0.1:0");
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJson.Default));
var app = builder.Build();
string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
string origin = "";
long lastSeen = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
app.Use(async (context, next) =>
{
    context.Response.Headers.CacheControl = "no-store";
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";
    context.Response.Headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'";
    if (context.Request.Host.Value != new Uri(origin).Authority ||
        (context.Request.Headers.Origin.Count > 0 && context.Request.Headers.Origin != origin))
    { context.Response.StatusCode = 403; return; }
    if (context.Request.Path.StartsWithSegments("/api") && context.Request.Headers["X-Session"] != token)
    { context.Response.StatusCode = 401; return; }
    try { await next(context); }
    catch (Exception ex)
    {
        context.Response.StatusCode = ex is KeyNotFoundException ? 404 : 400;
        await context.Response.WriteAsJsonAsync(new Message(ex.Message), AppJson.Default.Message);
    }
});
foreach (var (route, resource, type) in new[] {
    ("/", "index.html", "text/html; charset=utf-8"), ("/app.js", "app.js", "text/javascript; charset=utf-8"),
    ("/style.css", "style.css", "text/css; charset=utf-8"), ("/vue.js", "vue.js", "text/javascript; charset=utf-8"),
    ("/headroom.svg", "headroom.svg", "image/svg+xml") })
{
    using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("web/" + resource)
        ?? throw new InvalidOperationException("Missing embedded UI: " + resource);
    using var buffer = new MemoryStream(); stream.CopyTo(buffer);
    byte[] bytes = buffer.ToArray();
    app.MapGet(route, () => Results.Bytes(bytes, type));
}
app.MapGet("/api/accounts", () =>
{
    Interlocked.Exchange(ref lastSeen, DateTimeOffset.UtcNow.ToUnixTimeSeconds());
    return Results.Json(accounts.Snapshot(), AppJson.Default.DashboardView);
});
app.MapPost("/api/accounts/login", async (LoginInput input) => Results.Json(await accounts.AddAndLoginAsync(input.DeviceCode), AppJson.Default.LoginInfo));
app.MapDelete("/api/accounts/{id}", async (string id) => { await accounts.RemoveAsync(id); return Results.NoContent(); });
app.MapPost("/api/accounts/{id}/refresh", async (string id) => { await accounts.RefreshAsync(id); return Results.NoContent(); });
app.MapPost("/api/refresh", async () => { await accounts.RefreshAllAsync(); return Results.NoContent(); });
app.MapPost("/api/accounts/{id}/login", async (string id, LoginInput input) => Results.Json(await accounts.LoginAsync(id, input.DeviceCode), AppJson.Default.LoginInfo));
app.MapPost("/api/login/cancel", async () => { await accounts.CancelLoginAsync(); return Results.NoContent(); });
app.MapPost("/api/login/open", () =>
{
    var pending = accounts.Snapshot().Login ?? throw new InvalidOperationException("No sign-in is pending.");
    Browser.Open(pending.Url);
    return Results.NoContent();
});
app.MapPost("/api/window/activate", () => { desktop.Activate(); return Results.NoContent(); });
app.MapPost("/api/quit", () =>
{
    _ = Task.Run(async () => { await Task.Delay(250); app.Lifetime.StopApplication(); });
    return Results.NoContent();
});
await app.StartAsync();
origin = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
string launchUrl = origin + "/#" + token;
File.WriteAllText(instancePath, JsonSerializer.Serialize(new InstanceInfo(launchUrl), AppJson.Default.InstanceInfo));
ready.TrySetResult(new DesktopStart(launchUrl, data));
using var closeWindow = app.Lifetime.ApplicationStopping.Register(desktop.RequestClose);
using var stopping = new CancellationTokenSource();
var refreshLoop = Task.Run(async () =>
{
    try
    {
        while (!stopping.IsCancellationRequested)
        {
            if (DateTimeOffset.UtcNow.ToUnixTimeSeconds() - Interlocked.Read(ref lastSeen) < 90)
                await accounts.RefreshAllAsync();
            await Task.Delay(TimeSpan.FromSeconds(60), stopping.Token);
        }
    }
    catch (OperationCanceledException) { }
});
try { await app.WaitForShutdownAsync(shutdown); }
finally
{
    stopping.Cancel();
    try { await refreshLoop.WaitAsync(TimeSpan.FromSeconds(35)); } catch { }
    File.Delete(instancePath);
}
return 0;
    }
}

internal static class Browser
{
    public static void Open(string url)
    {
        if (OperatingSystem.IsWindows()) Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        else
        {
            var start = new ProcessStartInfo(OperatingSystem.IsMacOS() ? "open" : "xdg-open") { UseShellExecute = false };
            start.ArgumentList.Add(url); Process.Start(start);
        }
    }
}
