using Photino.NET;
using System.Text.Json;

namespace Headroom;

internal sealed record DesktopStart(string Url, string DataDirectory, Func<Task> Refresh, bool Background);

internal sealed class DesktopWindow
{
    private PhotinoWindow? window;
    private volatile bool created;
    private volatile bool closing;
    private volatile bool closeRequested;
    private bool webReady;
    private SystemTray? tray;
    private WindowIcon? windowIcon;
    private string dataDirectory = "";
    private bool hideOnReady;

    // Called on the application's original STA thread, also the GTK main thread on Linux.
    public void Run(DesktopStart start, Action stop)
    {
        hideOnReady = start.Background;
        dataDirectory = start.DataDirectory;
        string iconFile = AppIcon.WindowIcon(dataDirectory, PortableStorage.Settings().Theme);
        if (OperatingSystem.IsWindows()) WindowIcon.PrepareTaskbar(iconFile);
        // WebView2's environment override takes precedence over its API parameter.
        // Keep the profile in the portable folder even if the parent process sets it.
        if (OperatingSystem.IsWindows())
            Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", Path.Combine(start.DataDirectory, "webview"));
        window = new PhotinoWindow()
            .SetLogVerbosity(0)
            .SetTitle("Headroom")
            .SetChromeless(true)
            .SetUseOsDefaultLocation(false)
            .SetUseOsDefaultSize(false)
            .SetSize(1200, 780)
            .SetMinSize(680, 480)
            .SetResizable(true)
            .SetMinimized(start.Background)
            .SetTemporaryFilesPath(Path.Combine(start.DataDirectory, "webview"))
            .SetContextMenuEnabled(false)
            .SetDevToolsEnabled(false)
            .SetGrantBrowserPermissions(false)
            .SetFileSystemAccessEnabled(false)
            .SetMediaStreamEnabled(false)
            .SetNotificationsEnabled(false)
            .Center()
            .RegisterWebMessageReceivedHandler((_, message) => HandleMessage(message))
            .RegisterMaximizedHandler((_, _) => SendState())
            .RegisterRestoredHandler((_, _) => SendState())
            .RegisterWindowCreatedHandler((_, _) =>
            {
                created = true;
                WindowGestures.Configure(window!);
                if (OperatingSystem.IsWindows())
                {
                    windowIcon = new(window!.WindowHandle);
                    windowIcon.Set(iconFile, requireTaskbarUpdate: false);
                    tray = new(window!.WindowHandle, iconFile,
                        () => _ = Task.Run(async () => { try { await start.Refresh(); } catch { } }), RequestClose);
                }
                if (closeRequested) window!.Close();
            })
            .RegisterWindowClosingHandler((_, _) =>
            {
                if (!closeRequested && OperatingSystem.IsWindows() && tray?.Available == true)
                { tray.Hide(); return true; }
                closing = true;
                stop();
                return false;
            })
            .Load(start.Url);
        if (!OperatingSystem.IsWindows()) window.SetIconFile(iconFile);
        try { window.WaitForClose(); }
        finally
        {
            if (OperatingSystem.IsWindows()) { tray?.Dispose(); windowIcon?.Dispose(); }
            closing = true; created = false; stop();
        }
    }

    public void ApplyTheme(string theme)
    {
        if (!created || closing) return; // Headless checks have no native surfaces.
        Exception? failure = null;
        window!.Invoke(() =>
        {
            if (closing || closeRequested) return;
            try
            {
                string iconFile = AppIcon.WindowIcon(dataDirectory, theme);
                if (OperatingSystem.IsWindows()) { windowIcon?.Set(iconFile); tray?.SetIcon(iconFile); }
                else window.SetIconFile(iconFile);
            }
            catch (Exception ex) { failure = ex; } // Never unwind through Photino's native callback.
        });
        if (failure is not null) throw new InvalidOperationException("Could not update the theme icons.", failure);
    }

    public void RequestClose()
    {
        closeRequested = true;
        if (created && !closing) window?.Close();
    }

    public void Activate()
    {
        if (!created || closing) return;
        window!.Invoke(() =>
        {
            if (OperatingSystem.IsWindows() && tray is not null) tray.Show();
            else window.SetMinimized(false).SetTopMost(true).SetTopMost(false);
        });
    }

    private void SendState()
    {
        if (created && webReady && !closing)
        {
            window!.SendWebMessage(window.Maximized ? "window:maximized" : "window:restored");
            window.SendWebMessage(OperatingSystem.IsWindows() && tray?.Available == true ? "window:tray" : "window:no-tray");
        }
    }

    private void HandleMessage(string message)
    {
        if (!created || closing || message.Length > 256) return;
        try
        {
            using var document = JsonDocument.Parse(message);
            var request = document.RootElement;
            switch (request.Field("action").Text())
            {
                case "ready":
                    webReady = true; SendState();
                    if (hideOnReady && OperatingSystem.IsWindows()) { tray?.Hide(); hideOnReady = false; }
                    break;
                case "minimize": window!.SetMinimized(true); break;
                case "maximize": window!.SetMaximized(!window.Maximized); SendState(); break;
                case "close": window!.Close(); break;
                case "drag":
                case "resize":
                    string? edge = request.Field("action").Text() == "resize" ? request.Field("edge").Text() : null;
                    // Caption drags must reach the OS even while maximized, so it can
                    // restore under the pointer once the native drag threshold is crossed.
                    if (edge is null || !window!.Maximized)
                        WindowGestures.Begin(window!, edge, (int)(request.Field("x").Number() ?? 0), (int)(request.Field("y").Number() ?? 0));
                    break;
            }
        }
        catch (JsonException) { } // Ignore malformed webview messages.
        catch (OverflowException) { }
    }
}
