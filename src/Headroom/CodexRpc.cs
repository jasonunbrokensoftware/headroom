using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace Headroom;

internal sealed class CodexRpc : IAsyncDisposable
{
    private readonly Process process;
    private readonly ConcurrentDictionary<int, TaskCompletionSource<JsonElement>> pending = new();
    private readonly SemaphoreSlim writer = new(1, 1);
    private readonly Task reader;
    private int nextId;
    private bool disposed;
    public TaskCompletionSource<JsonElement> LoginCompleted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public static string FindExecutable()
    {
        var name = OperatingSystem.IsWindows() ? "codex.exe" : "codex";
        var specified = PortableStorage.Settings().CodexPath;
        if (!string.IsNullOrWhiteSpace(specified))
        {
            string configured = Path.GetFullPath(specified, AppContext.BaseDirectory);
            if (File.Exists(configured)) return configured;
            throw new InvalidOperationException("The Codex path in settings.json was not found.");
        }
        foreach (string relative in new[] { name, Path.Combine("tools", name) })
        {
            string portable = Path.Combine(AppContext.BaseDirectory, relative);
            if (File.Exists(portable)) return portable;
        }
        foreach (var folder in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
        {
            var path = Path.Combine(folder.Trim('"'), name);
            if (File.Exists(path)) return path;
        }
        if (OperatingSystem.IsWindows())
        {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var root = Path.Combine(local, "OpenAI", "Codex", "bin");
            if (Directory.Exists(root))
            {
                var latest = Directory.EnumerateFiles(root, "codex.exe", SearchOption.AllDirectories)
                    .OrderByDescending(File.GetLastWriteTimeUtc).FirstOrDefault();
                if (latest is not null) return latest;
            }
            var standalone = Path.Combine(local, "Programs", "OpenAI", "Codex", "bin", name);
            if (File.Exists(standalone)) return standalone;
        }
        else
        {
            var standalone = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".local", "bin", name);
            if (File.Exists(standalone)) return standalone;
            foreach (string bundled in new[] { "/usr/lib/chatgpt/resources/codex", "/opt/ChatGPT/resources/codex", "/opt/Codex/resources/codex" })
                if (File.Exists(bundled)) return bundled;
        }
        throw new InvalidOperationException("Codex CLI was not found. Install Codex, place it in the tools folder beside Headroom, or set codexPath in settings.json.");
    }

    private CodexRpc(string home, bool migrateCredentials)
    {
        Directory.CreateDirectory(home);
        PortableCredentials.Prepare(home, migrateCredentials);
        var start = new ProcessStartInfo(FindExecutable())
        {
            WorkingDirectory = home, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardInputEncoding = new UTF8Encoding(false), StandardOutputEncoding = Encoding.UTF8
        };
        start.ArgumentList.Add("app-server"); start.ArgumentList.Add("--listen"); start.ArgumentList.Add("stdio://");
        start.ArgumentList.Add("-c"); start.ArgumentList.Add("cli_auth_credentials_store=\"file\"");
        start.Environment["CODEX_HOME"] = home;
        start.Environment["CODEX_SQLITE_HOME"] = home;
        string temporary = Path.Combine(home, "tmp");
        Directory.CreateDirectory(temporary);
        foreach (string key in new[] { "TEMP", "TMP", "TMPDIR" }) start.Environment[key] = temporary;
        foreach (string key in new[] { "OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN", "CODEX_REMOTE", "CODEX_REMOTE_TOKEN" })
            start.Environment.Remove(key);
        process = Process.Start(start) ?? throw new InvalidOperationException("Could not start Codex.");
        // Drain without persisting auth URLs, tokens, or raw service responses.
        _ = Task.Run(async () => { while (await process.StandardError.ReadLineAsync() is not null) { } });
        reader = ReadAsync();
    }

    public static async Task<CodexRpc> StartAsync(string home, bool migrateCredentials = true)
    {
        var rpc = new CodexRpc(home, migrateCredentials);
        try
        {
            await rpc.CallAsync("initialize", """{"clientInfo":{"name":"headroom","title":"Headroom","version":"2.0"}}""");
            await rpc.SendAsync("""{"method":"initialized","params":{}}""");
            return rpc;
        }
        catch { await rpc.DisposeAsync(); throw; }
    }

    private async Task SendAsync(string json)
    {
        await writer.WaitAsync();
        try { await process.StandardInput.WriteLineAsync(json); await process.StandardInput.FlushAsync(); }
        finally { writer.Release(); }
    }

    public async Task<JsonElement> CallAsync(string method, string parameters = "{}")
    {
        int id = Interlocked.Increment(ref nextId);
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        pending[id] = completion;
        try
        {
            await SendAsync($"{{\"id\":{id},\"method\":{JsonFields.Quote(method)},\"params\":{parameters}}}");
            return await completion.Task.WaitAsync(TimeSpan.FromSeconds(30));
        }
        catch (TimeoutException) { throw new InvalidOperationException("Codex did not respond. Check your connection and refresh."); }
        finally { pending.TryRemove(id, out _); }
    }

    private async Task ReadAsync()
    {
        try
        {
            while (await process.StandardOutput.ReadLineAsync() is string line)
            {
                JsonDocument document;
                try { document = JsonDocument.Parse(line); } catch (JsonException) { continue; }
                using (document)
                {
                    var message = document.RootElement;
                    if (message.Field("id").Number() is long id && !message.Field("method").Present() && pending.TryGetValue((int)id, out var call))
                    {
                        if (message.Field("error").Present())
                            call.TrySetException(new InvalidOperationException(message.Field("error").Field("message").Text() ?? "Codex request failed."));
                        else call.TrySetResult(message.Field("result").Clone());
                    }
                    else if (message.Field("method").Text() == "account/login/completed")
                        LoginCompleted.TrySetResult(message.Field("params").Clone());
                }
            }
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException) { }
        finally
        {
            foreach (var call in pending.Values) call.TrySetException(new IOException("Codex disconnected. Try Refresh."));
            LoginCompleted.TrySetException(new IOException("Codex disconnected during sign-in."));
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (disposed) return;
        disposed = true;
        try
        {
            process.StandardInput.Close();
            await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3));
        }
        catch { try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch { } }
        try { await reader.WaitAsync(TimeSpan.FromSeconds(2)); } catch { }
        process.Dispose();
    }
}
