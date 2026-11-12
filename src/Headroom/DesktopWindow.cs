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
    private IDesktopTray? tray;
    private WindowIcon? windowIcon;
    private StartupVisibility visibility = new(false);
    private volatile bool activationRequested;
    private bool aboutRequested;

    // Called on the application's original STA thread, also the GTK main thread on Linux.
    public void Run(DesktopStart start, Action stop)
    {
        visibility = new(start.Background && !activationRequested);
        string iconFile = AppIcon.WindowIcon(start.DataDirectory);
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
                if (activationRequested) visibility.RequestShow();
                WindowGestures.Configure(window!);
                if (OperatingSystem.IsWindows())
                {
                    windowIcon = new(window!.WindowHandle);
                    windowIcon.Set(iconFile, requireTaskbarUpdate: false);
                    tray = new SystemTray(window!.WindowHandle, iconFile,
                        () => _ = Task.Run(async () => { try { await start.Refresh(); } catch { } }), RequestClose, Activate, ShowAbout);
                }
                else if (OperatingSystem.IsLinux())
                    tray = new LinuxTray(iconFile,
                        () => _ = Task.Run(async () => { try { await start.Refresh(); } catch { } }),
                        RequestClose, Activate, ShowAbout, TrayChanged);
                // A desktop without a tray must not leave the application unreachable.
                if (tray?.Available != true) visibility.RequestShow();
                if (closeRequested) window!.Close();
            })
            .RegisterWindowClosingHandler((_, _) =>
            {
                if (!closeRequested && tray?.Available == true)
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
            tray?.Dispose();
            if (OperatingSystem.IsWindows()) windowIcon?.Dispose();
            closing = true; created = false; stop();
        }
    }

    public void RequestClose()
    {
        closeRequested = true;
        if (created && !closing) window?.Close();
    }

    public void Activate()
    {
        if (closing) return;
        activationRequested = true;
        if (!created) return;
        window!.Invoke(() =>
        {
            if (!visibility.RequestShow()) return;
            if (tray is not null) tray.Show();
            else window.SetMinimized(false).SetTopMost(true).SetTopMost(false);
        });
    }

    // The tray callback runs on the window thread. Queue early requests until Vue is ready.
    private void ShowAbout()
    {
        aboutRequested = true;
        Activate();
        if (webReady && !closing)
        {
            window!.SendWebMessage("window:about");
            aboutRequested = false;
        }
    }

    private void SendState()
    {
        if (created && webReady && !closing)
        {
            window!.SendWebMessage(window.Maximized ? "window:maximized" : "window:restored");
            window.SendWebMessage(tray?.Available == true ? "window:tray" : "window:no-tray");
        }
    }

    private void TrayChanged()
    {
        SendState();
        if (visibility.Painted && tray?.Available == false) Activate();
    }

    internal int TestState()
    {
        int result = 0;
        if (created && !closing && OperatingSystem.IsLinux()) window!.Invoke(() =>
        {
            if (OperatingSystem.IsLinux()) result = LinuxDesktop.WindowState();
        });
        return result;
    }
    internal void TestAction(int command)
    {
        if (created && !closing && OperatingSystem.IsLinux()) window!.Invoke(() =>
        {
            if (command == 0) window.Close();
            else if (OperatingSystem.IsLinux()) LinuxDesktop.TestMenu(command);
        });
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
                    if (aboutRequested) ShowAbout();
                    break;
                case "painted":
                    if (!visibility.Painted)
                    {
                        bool reveal = visibility.CompletePaint();
                        if (OperatingSystem.IsWindows()) NativeDesktop.CompleteWindowStartup(window!.WindowHandle, reveal ? 1 : 0);
                        else if (OperatingSystem.IsLinux()) LinuxDesktop.CompleteStartup(reveal ? 1 : 0);
                    }
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
