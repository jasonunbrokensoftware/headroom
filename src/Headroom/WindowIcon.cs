using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Headroom;

// Own these handles instead of Photino's shared icon loader: file-based icons
// must not use LR_SHARED, and repeated theme changes must release old handles.
[SupportedOSPlatform("windows")]
internal sealed partial class WindowIcon(nint window) : IDisposable
{
    private nint icon;
    private static readonly string PinnedDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar");
    private static int UpdateTaskbar(nint handle, string icon) => NativeDesktop.SetTaskbarIcon(handle, Environment.ProcessPath!, icon,
        PinnedDirectory, Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
        Environment.GetFolderPath(Environment.SpecialFolder.StartMenu));
    internal static void PrepareTaskbar(string icon)
    {
        // Synchronize this EXE's launch shortcuts before its first window is shown.
        // A locked/read-only pin must not prevent the app from opening. A theme
        // change reports synchronization failures through the appearance API.
        _ = UpdateTaskbar(0, icon);
    }
    public void Set(string path, bool requireTaskbarUpdate = true)
    {
        SetWindowIcons(path, GetDpiForWindow(window));
        int result = UpdateTaskbar(window, path);
        if (requireTaskbarUpdate) Marshal.ThrowExceptionForHR(result);
    }
    internal void SetWindowIcons(string path, uint dpi)
    {
        // Shell consumers can select either window-icon slot. A caption-sized
        // HICON (24px at 150%) can appear at one quarter the area of the 48px
        // image. This window has a custom Vue title bar, so provide the full-size
        // source for both slots; Windows scales it down where appropriate.
        // https://learn.microsoft.com/windows/win32/winmsg/wm-seticon
        nint next = Load(path, GetSystemMetricsForDpi(11, dpi)); // SM_CXICON
        SendMessageW(window, 0x80, 1, next); // ICON_BIG: publish the full-size icon first.
        SendMessageW(window, 0x80, 0, next); // ICON_SMALL / ICON_SMALL2 use the same full-size source.
        Release(icon); // One owned handle, referenced by both slots.
        icon = next;
    }
    internal static nint Load(string path, int size)
    {
        nint icon = LoadImageW(0, path, 1, size, size, 0x10); // IMAGE_ICON, LR_LOADFROMFILE
        return icon != 0 ? icon : throw new Win32Exception(Marshal.GetLastPInvokeError(), "Could not load the themed icon.");
    }
    internal static void Release(nint icon) { if (icon != 0) DestroyIcon(icon); }
    public void Dispose() { Release(icon); icon = 0; }
    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
    private static partial nint LoadImageW(nint instance, string path, uint type, int width, int height, uint flags);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool DestroyIcon(nint icon);
    [LibraryImport("user32.dll")] private static partial nint SendMessageW(nint window, uint message, nint wParam, nint lParam);
    [LibraryImport("user32.dll")] private static partial uint GetDpiForWindow(nint window);
    [LibraryImport("user32.dll")] private static partial int GetSystemMetricsForDpi(int index, uint dpi);
}
