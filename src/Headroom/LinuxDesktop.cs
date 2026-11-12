using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Headroom;

[SupportedOSPlatform("linux")]
internal static unsafe partial class LinuxDesktop
{
    [LibraryImport("Photino.Native", EntryPoint = "Headroom_LinuxCompleteStartup")]
    internal static partial void CompleteStartup(int reveal);
    [LibraryImport("Photino.Native", EntryPoint = "Headroom_LinuxShow")]
    internal static partial void Show();
    [LibraryImport("Photino.Native", EntryPoint = "Headroom_LinuxHide")]
    internal static partial void Hide();
    [LibraryImport("Photino.Native", EntryPoint = "Headroom_LinuxTrayAvailable")]
    internal static partial int TrayAvailable();
    [LibraryImport("Photino.Native", EntryPoint = "Headroom_LinuxTraySetStartup")]
    internal static partial void SetStartup(int enabled);
    [LibraryImport("Photino.Native", EntryPoint = "Headroom_LinuxTrayCreate", StringMarshalling = StringMarshalling.Utf8)]
    internal static partial void CreateTray(string icon, int startup, delegate* unmanaged<int, void> callback);
    [LibraryImport("Photino.Native", EntryPoint = "Headroom_LinuxTrayDestroy")]
    internal static partial void DestroyTray();
    [LibraryImport("Photino.Native", EntryPoint = "Headroom_LinuxError", StringMarshalling = StringMarshalling.Utf8)]
    internal static partial void ShowError(string message);
    [LibraryImport("Photino.Native", EntryPoint = "Headroom_LinuxWindowState")]
    internal static partial int WindowState();
    [LibraryImport("Photino.Native", EntryPoint = "Headroom_LinuxTestMenu")]
    internal static partial void TestMenu(int command);
}

[SupportedOSPlatform("linux")]
internal sealed unsafe class LinuxTray : IDesktopTray
{
    private static LinuxTray? current;
    private readonly Action refresh, quit, open, about, changed;
    public bool Available => LinuxDesktop.TrayAvailable() != 0;
    internal LinuxTray(string icon, Action refresh, Action quit, Action open, Action about, Action changed)
    {
        this.refresh = refresh; this.quit = quit; this.open = open; this.about = about; this.changed = changed;
        current = this;
        LinuxDesktop.CreateTray(icon, PortableStorage.Settings().StartWithWindows ? 1 : 0, &Dispatch);
        if (!FlatpakEnvironment.Active)
            try { LinuxAutostart.Apply(PortableStorage.Settings().StartWithWindows); } catch { }
    }
    public void Show() => LinuxDesktop.Show();
    public void Hide() { if (Available) LinuxDesktop.Hide(); }
    [UnmanagedCallersOnly]
    private static void Dispatch(int command)
    {
        try
        {
            var tray = current;
            if (tray is null) return;
            switch (command)
            {
                case 1: tray.open(); break;
                case 2: tray.refresh(); break;
                case 3:
                    bool before = PortableStorage.Settings().StartWithWindows;
                    try
                    {
                        LinuxAutostart.Apply(!before);
                        PortableStorage.UpdateSettings(settings => settings with { StartWithWindows = !before });
                    }
                    catch (Exception ex)
                    {
                        try { LinuxAutostart.Apply(before); } catch { }
                        LinuxDesktop.ShowError("Could not change startup: " + ex.Message);
                    }
                    LinuxDesktop.SetStartup(PortableStorage.Settings().StartWithWindows ? 1 : 0);
                    break;
                case 4: tray.quit(); break;
                case 5: tray.about(); break;
                case 6: tray.changed(); break;
            }
        }
        catch { } // Never unwind through a GTK callback.
    }
    public void Dispose() { LinuxDesktop.DestroyTray(); current = null; }
}

internal static class LinuxAutostart
{
    // Desktop Exec values have their own quoting rules; no shell is involved.
    internal static string QuoteExec(string value)
    {
        if (value.Any(c => c is '\n' or '\r' or '\0')) throw new ArgumentException("Invalid launcher path.");
        // GIO checks the executable before expanding %% in Exec. A spec-escaped
        // percent therefore still produces an unusable launcher on GTK desktops.
        if (value.Contains('%')) throw new ArgumentException("Linux desktop launchers require an installation path without '%' characters.");
        return "\"" + value.Replace("\\", "\\\\\\\\").Replace("\"", "\\\\\"")
            .Replace("`", "\\\\`").Replace("$", "\\\\$").Replace("%", "%%") + "\"";
    }
    internal static string DesktopEntry(string executable, string icon, bool background) =>
        "[Desktop Entry]\nType=Application\nName=Headroom\nComment=Account usage and reset monitor\n" +
        "Exec=" + QuoteExec(executable) + (background ? " --background" : "") + "\n" +
        "Icon=" + icon.Replace("\\", "\\\\").Replace("\n", "\\n").Replace("\r", "\\r") + "\n" +
        "Terminal=false\nCategories=Utility;\nStartupWMClass=headroom\n";
    private static string Xdg(string variable, string fallback)
    {
        string? value = Environment.GetEnvironmentVariable(variable);
        return !string.IsNullOrEmpty(value) && Path.IsPathFullyQualified(value) ? value :
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), fallback);
    }
    internal static void Apply(bool enabled)
    {
        if (FlatpakEnvironment.Active) { FlatpakEnvironment.SetAutostart(enabled); return; }
        string path = Path.Combine(Xdg("XDG_CONFIG_HOME", ".config"), "autostart", "headroom.desktop");
        if (!enabled) { if (File.Exists(path)) File.Delete(path); return; }
        Write(path, true);
    }
    internal static void InstallLauncher()
    {
        if (FlatpakEnvironment.Active) return; // Flatpak exports the desktop entry.
        Write(Path.Combine(Xdg("XDG_DATA_HOME", ".local/share"), "applications", "headroom.desktop"), false);
        Apply(PortableStorage.Settings().StartWithWindows);
    }
    private static void Write(string path, bool background)
    {
        string executable = Environment.ProcessPath ?? throw new InvalidOperationException("Executable path is unavailable.");
        string icon = AppIcon.WindowIcon(PortableStorage.DataDirectory(null));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path + ".tmp", DesktopEntry(executable, icon, background));
        File.Move(path + ".tmp", path, true);
    }
}
