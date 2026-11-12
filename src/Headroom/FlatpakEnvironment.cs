using System.Diagnostics;

namespace Headroom;

internal static class FlatpakEnvironment
{
    internal const string AppId = "io.github.jasonunbrokensoftware.Headroom";
    internal static bool Active => OperatingSystem.IsLinux() &&
        Environment.GetEnvironmentVariable("FLATPAK_ID") == AppId && File.Exists("/.flatpak-info");

    // The host CLI keeps its own runtime dependencies. Only Headroom's isolated
    // account profile is shared with it; inherited API credentials are excluded.
    internal static ProcessStartInfo HostStart(string executable, IEnumerable<string> arguments,
        string? directory = null, IReadOnlyDictionary<string, string>? variables = null)
    {
        var start = new ProcessStartInfo("/usr/bin/flatpak-spawn")
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true
        };
        foreach (string flag in new[] { "--host", "--watch-bus", "--clear-env" }) start.ArgumentList.Add(flag);
        string userHome = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        start.ArgumentList.Add("--env=HOME=" + userHome);
        start.ArgumentList.Add("--env=PATH=/usr/local/bin:/usr/bin:/bin:" + Path.Combine(userHome, ".local/bin"));
        start.ArgumentList.Add("--env=LANG=C.UTF-8");
        if (directory is not null) start.ArgumentList.Add("--directory=" + directory);
        if (variables is not null)
            foreach (var variable in variables) start.ArgumentList.Add("--env=" + variable.Key + "=" + variable.Value);
        start.ArgumentList.Add(executable);
        foreach (string argument in arguments) start.ArgumentList.Add(argument);
        return start;
    }

    internal static ProcessStartInfo WrapCodex(ProcessStartInfo original)
    {
        var variables = new Dictionary<string, string>();
        foreach (string key in new[] { "CODEX_HOME", "CODEX_SQLITE_HOME", "TEMP", "TMP", "TMPDIR", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY" })
            if (original.Environment.TryGetValue(key, out string? value) && value is not null) variables[key] = value;
        var start = HostStart(original.FileName, original.ArgumentList, original.WorkingDirectory, variables);
        start.RedirectStandardInput = true;
        start.StandardInputEncoding = original.StandardInputEncoding;
        start.StandardOutputEncoding = original.StandardOutputEncoding;
        return start;
    }

    private static (int Code, string Output) HostCommand(string executable, params string[] arguments)
    {
        using var process = Process.Start(HostStart(executable, arguments))
            ?? throw new IOException("Could not reach the installed Codex CLI through Flatpak.");
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        if (!process.WaitForExit(10000))
        {
            try { process.Kill(); } catch { }
            throw new IOException("The Flatpak host service did not respond.");
        }
        _ = error.GetAwaiter().GetResult();
        return (process.ExitCode, output.GetAwaiter().GetResult().Trim());
    }

    internal static string FindCodex(string? specified)
    {
        if (!string.IsNullOrWhiteSpace(specified))
        {
            string configured = Path.GetFullPath(specified, PortableStorage.RootDirectory);
            if (HostCommand("/usr/bin/test", "-x", configured).Code == 0) return configured;
            throw new IOException("The host Codex path in settings.json was not found or is not executable.");
        }
        string userHome = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        foreach (string candidate in new[] { Path.Combine(PortableStorage.RootDirectory, "tools/codex"),
            Path.Combine(userHome, ".local/bin/codex"), "/usr/lib/chatgpt/resources/codex",
            "/opt/ChatGPT/resources/codex", "/opt/Codex/resources/codex", "/usr/local/bin/codex", "/usr/bin/codex" })
            if (HostCommand("/usr/bin/test", "-x", candidate).Code == 0) return candidate;
        throw new IOException("Install Codex on the host, or set codexPath in Headroom's settings.json to its absolute host path. Flatpak host-command access must be enabled.");
    }

    internal static void SetAutostart(bool enabled)
    {
        string? configured = Environment.GetEnvironmentVariable("HOST_XDG_CONFIG_HOME");
        string config = !string.IsNullOrEmpty(configured) && Path.IsPathFullyQualified(configured) ? configured :
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".config");
        string destination = Path.Combine(config, "autostart", AppId + ".desktop");
        if (!enabled)
        {
            if (HostCommand("/usr/bin/rm", "-f", "--", destination).Code != 0) throw new IOException("Could not remove the Headroom startup entry.");
            return;
        }
        string staging = Path.Combine(PortableStorage.RootDirectory, "autostart-" + Guid.NewGuid().ToString("N") + ".desktop");
        try
        {
            File.WriteAllText(staging, "[Desktop Entry]\nType=Application\nName=Headroom\n" +
                "Exec=/usr/bin/flatpak run --branch=stable --arch=x86_64 " + AppId + " --background\n" +
                "Icon=" + AppId + "\nTerminal=false\nX-Flatpak=" + AppId + "\n");
            if (HostCommand("/usr/bin/install", "-Dm644", "--", staging, destination).Code != 0)
                throw new IOException("Could not install the Headroom startup entry.");
        }
        finally { File.Delete(staging); }
    }
}
