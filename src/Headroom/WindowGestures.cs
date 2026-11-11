using System.Runtime.InteropServices;
using System.Runtime.CompilerServices;
using Photino.NET;

namespace Headroom;

// Begin the OS move/resize loop, so dragging works outside the webview and across monitors.
internal static partial class WindowGestures
{
    public static unsafe void Configure(PhotinoWindow window)
    {
        if (!OperatingSystem.IsWindows()) return;
        // Keep native sizing and taskbar behavior while drawing the whole frame in Vue.
        window.SetResizable(true);
        SetWindowSubclass(window.WindowHandle, &FrameProcedure, 1, 0);
        // Keep caption behavior (including drag-to-restore and snapping) for
        // DefWindowProc. WM_NCCALCSIZE below still hides the entire native frame.
        // https://learn.microsoft.com/en-us/windows/win32/dwm/customframe
        SetWindowLongPtrW(window.WindowHandle, -16, GetWindowLongPtrW(window.WindowHandle, -16) | 0x00C00000); // GWL_STYLE, WS_CAPTION
        SetWindowPos(window.WindowHandle, 0, 0, 0, 0, 0, 0x0037); // FRAMECHANGED, no move/size/activation/z-order
    }

    [UnmanagedCallersOnly(CallConvs = [typeof(CallConvStdcall)])]
    private static unsafe nint FrameProcedure(nint hwnd, uint message, nuint wParam, nint lParam, nuint id, nuint data)
    {
        if (message == 0x0083 && wParam != 0) return 0; // WM_NCCALCSIZE: no OS title bar or frame.
        nint result = DefSubclassProc(hwnd, message, wParam, lParam);
        if (message == 0x0024 && lParam != 0) // WM_GETMINMAXINFO: respect the taskbar on every monitor.
        {
            var info = new MonitorInfo { Size = (uint)sizeof(MonitorInfo) };
            if (GetMonitorInfoW(MonitorFromWindow(hwnd, 2), ref info))
            {
                var bounds = (MinMaxInfo*)lParam;
                bounds->MaxPosition = new Point { X = info.Work.Left - info.Monitor.Left, Y = info.Work.Top - info.Monitor.Top };
                bounds->MaxSize = new Point { X = info.Work.Right - info.Work.Left, Y = info.Work.Bottom - info.Work.Top };
            }
        }
        return result;
    }

    internal static (int Windows, int Gtk) HitTest(string? edge) => edge switch
    {
        null => (2, -1), "nw" => (13, 0), "n" => (12, 1), "ne" => (14, 2),
        "w" => (10, 3), "e" => (11, 4), "sw" => (16, 5), "s" => (15, 6), "se" => (17, 7),
        _ => (0, -2)
    };

    public static void Begin(PhotinoWindow window, string? edge, int x, int y)
    {
        var hit = HitTest(edge);
        if (hit.Windows == 0) return;
        if (OperatingSystem.IsWindows())
        {
            if (!GetCursorPos(out var point)) return;
            ReleaseCapture();
            // Post instead of blocking the WebView2 message callback in a modal move loop.
            PostMessageW(window.WindowHandle, 0x00A1, hit.Windows,
                (nint)((point.Y << 16) | (point.X & 0xffff)));
        }
        else if (OperatingSystem.IsLinux())
        {
            // GTK handles are intentionally kept inside this platform adapter.
            nint list = gtk_window_list_toplevels();
            try
            {
                for (nint item = list; item != 0; item = Marshal.ReadIntPtr(item, IntPtr.Size))
                {
                    nint gtkWindow = Marshal.ReadIntPtr(item);
                    if (Marshal.PtrToStringUTF8(gtk_window_get_title(gtkWindow)) != "Headroom") continue;
                    uint time = gtk_get_current_event_time();
                    if (edge is null) gtk_window_begin_move_drag(gtkWindow, 1, x, y, time);
                    else gtk_window_begin_resize_drag(gtkWindow, hit.Gtk, 1, x, y, time);
                    break;
                }
            }
            finally { if (list != 0) g_list_free(list); }
        }
    }

    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct MonitorInfo { public uint Size; public Rect Monitor, Work; public uint Flags; }
    [StructLayout(LayoutKind.Sequential)] private struct MinMaxInfo { public Point Reserved, MaxSize, MaxPosition, MinTrack, MaxTrack; }
    [LibraryImport("comctl32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    private static unsafe partial bool SetWindowSubclass(nint window, delegate* unmanaged[Stdcall]<nint, uint, nuint, nint, nuint, nuint, nint> callback, nuint id, nuint data);
    [LibraryImport("comctl32.dll")] private static partial nint DefSubclassProc(nint window, uint message, nuint wParam, nint lParam);
    [LibraryImport("user32.dll")] private static partial nint GetWindowLongPtrW(nint window, int index);
    [LibraryImport("user32.dll")] private static partial nint SetWindowLongPtrW(nint window, int index, nint value);
    [LibraryImport("user32.dll")] private static partial nint MonitorFromWindow(nint window, uint flags);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool GetMonitorInfoW(nint monitor, ref MonitorInfo info);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool SetWindowPos(nint window, nint after, int x, int y, int cx, int cy, uint flags);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool GetCursorPos(out Point point);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool ReleaseCapture();
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool PostMessageW(nint window, uint message, nint wParam, nint lParam);
    [LibraryImport("libgtk-3.so.0")] private static partial nint gtk_window_list_toplevels();
    [LibraryImport("libgtk-3.so.0")] private static partial nint gtk_window_get_title(nint window);
    [LibraryImport("libgtk-3.so.0")] private static partial uint gtk_get_current_event_time();
    [LibraryImport("libgtk-3.so.0")] private static partial void gtk_window_begin_move_drag(nint window, int button, int x, int y, uint time);
    [LibraryImport("libgtk-3.so.0")] private static partial void gtk_window_begin_resize_drag(nint window, int edge, int button, int x, int y, uint time);
    [LibraryImport("libglib-2.0.so.0")] private static partial void g_list_free(nint list);
}
