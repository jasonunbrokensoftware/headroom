using Photino.NET;
using System.Text.Json;

namespace Headroom;

internal sealed record DesktopStart(string Url, string DataDirectory);

internal sealed class DesktopWindow
{
    private PhotinoWindow? window;
    private volatile bool created;
    private volatile bool closing;
    private volatile bool closeRequested;
    private bool webReady;

    // Called on the application's original STA thread, also the GTK main thread on Linux.
    public void Run(DesktopStart start, Action stop)
    {
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
                WindowGestures.Configure(window!);
                if (closeRequested) window!.Close();
            })
            .RegisterWindowClosingHandler((_, _) =>
            {
                closing = true;
                stop();
                return false;
            })
            .Load(start.Url);
        try { window.WaitForClose(); }
        finally { closing = true; created = false; stop(); }
    }

    public void RequestClose()
    {
        closeRequested = true;
        if (created && !closing) window?.Close();
    }

    public void Activate()
    {
        if (!created || closing) return;
        window!.Invoke(() => window.SetMinimized(false).SetTopMost(true).SetTopMost(false));
    }

    private void SendState()
    {
        if (created && webReady && !closing) window!.SendWebMessage(window.Maximized ? "window:maximized" : "window:restored");
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
                case "ready": webReady = true; SendState(); break;
                case "minimize": window!.SetMinimized(true); break;
                case "maximize": window!.SetMaximized(!window.Maximized); SendState(); break;
                case "close": window!.Close(); break;
                case "drag":
                case "resize":
                    string? edge = request.Field("action").Text() == "resize" ? request.Field("edge").Text() : null;
                    if (!window!.Maximized)
                        WindowGestures.Begin(window, edge, (int)(request.Field("x").Number() ?? 0), (int)(request.Field("y").Number() ?? 0));
                    break;
            }
        }
        catch (JsonException) { } // Ignore malformed webview messages.
        catch (OverflowException) { }
    }
}
