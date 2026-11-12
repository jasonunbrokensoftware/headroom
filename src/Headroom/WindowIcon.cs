using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Headroom;

// Own these handles instead of Photino's shared icon loader: file-based icons
// must not use LR_SHARED, and repeated theme changes must release old handles.
[SupportedOSPlatform("windows")]
internal sealed partial class WindowIcon(nint window) : IDisposable
{
    private nint small, large;
    private static readonly string PinnedDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar");
    internal static void PrepareTaskbar(string icon)
    {
        // Migrate this EXE's existing pin before its first window is shown.
        // A locked/read-only pin must not prevent the app from opening. A theme
        // change reports synchronization failures through the appearance API.
        _ = NativeDesktop.SetTaskbarIcon(0, Environment.ProcessPath!, icon, PinnedDirectory);
    }
    public void Set(string path, bool requireTaskbarUpdate = true)
    {
        uint dpi = GetDpiForWindow(window);
        nint nextSmall = Load(path, GetSystemMetricsForDpi(49, dpi)); // SM_CXSMICON
        nint nextLarge;
        try { nextLarge = Load(path, GetSystemMetricsForDpi(11, dpi)); } // SM_CXICON
        catch { Release(nextSmall); throw; }
        SendMessageW(window, 0x80, 0, nextSmall); // WM_SETICON, ICON_SMALL
        SendMessageW(window, 0x80, 1, nextLarge); // ICON_BIG (taskbar / Alt+Tab)
        Release(small); Release(large);
        small = nextSmall; large = nextLarge;
        int result = NativeDesktop.SetTaskbarIcon(window, Environment.ProcessPath!, path, PinnedDirectory);
        if (requireTaskbarUpdate) Marshal.ThrowExceptionForHR(result);
    }
    internal static nint Load(string path, int size)
    {
        nint icon = LoadImageW(0, path, 1, size, size, 0x10); // IMAGE_ICON, LR_LOADFROMFILE
        return icon != 0 ? icon : throw new Win32Exception(Marshal.GetLastPInvokeError(), "Could not load the themed icon.");
    }
    internal static void Release(nint icon) { if (icon != 0) DestroyIcon(icon); }
    public void Dispose() { Release(small); Release(large); small = large = 0; }
    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16, SetLastError = true)]
    private static partial nint LoadImageW(nint instance, string path, uint type, int width, int height, uint flags);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool DestroyIcon(nint icon);
    [LibraryImport("user32.dll")] private static partial nint SendMessageW(nint window, uint message, nint wParam, nint lParam);
    [LibraryImport("user32.dll")] private static partial uint GetDpiForWindow(nint window);
    [LibraryImport("user32.dll")] private static partial int GetSystemMetricsForDpi(int index, uint dpi);
}
