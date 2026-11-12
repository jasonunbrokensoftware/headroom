using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Headroom;

[SupportedOSPlatform("windows")]
internal static partial class WindowIconTests
{
    internal static void Run(Action<bool, string> check, string firstIcon, string secondIcon)
    {
        // A message-only HWND cannot appear on the desktop or taskbar. Exercise
        // the real icon assignment without touching launch shortcuts or settings.
        nint window = CreateWindowExW(0, "STATIC", "", 0, 0, 0, 0, 0, -3, 0, 0, 0);
        check(window != 0, "Created a message-only fixture for native icon sizing");
        var icons = new WindowIcon(window);
        try
        {
            foreach (uint dpi in new uint[] { 96, 120, 144, 192, 240, 288, 384 })
            {
                int expected = (int)(32 * dpi / 96);
                bool sizesMatch = true;
                foreach (string path in new[] { firstIcon, secondIcon, firstIcon })
                {
                    icons.SetWindowIcons(path, dpi);
                    nint big = SendMessageW(window, 0x7f, 1, (nint)dpi); // WM_GETICON
                    foreach (int slot in new[] { 0, 1, 2 })
                    {
                        nint handle = SendMessageW(window, 0x7f, slot, (nint)dpi);
                        sizesMatch &= handle != 0 && handle == big && Size(handle) == (expected, expected);
                    }
                }
                check(sizesMatch, $"All window-icon slots retain a full {expected}px source at {dpi} DPI across theme changes");
            }
            check(!IsWindowVisible(window), "Icon changes keep the message-only fixture invisible");
        }
        finally { DestroyWindow(window); icons.Dispose(); }
    }

    private static (int, int) Size(nint icon)
    {
        if (!GetIconInfo(icon, out var info)) return (0, 0);
        try
        {
            return GetObjectW(info.Color, Marshal.SizeOf<Bitmap>(), out var bitmap) != 0
                ? (bitmap.Width, bitmap.Height) : (0, 0);
        }
        finally { if (info.Mask != 0) DeleteObject(info.Mask); if (info.Color != 0) DeleteObject(info.Color); }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IconInfo { public int IsIcon; public uint HotspotX, HotspotY; public nint Mask, Color; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Bitmap { public int Type, Width, Height, WidthBytes; public ushort Planes, BitsPerPixel; public nint Bits; }
    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16)]
    private static partial nint CreateWindowExW(uint extendedStyle, string className, string title, uint style,
        int x, int y, int width, int height, nint parent, nint menu, nint instance, nint parameter);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool DestroyWindow(nint window);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool IsWindowVisible(nint window);
    [LibraryImport("user32.dll")] private static partial nint SendMessageW(nint window, uint message, nint wParam, nint lParam);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool GetIconInfo(nint icon, out IconInfo info);
    [LibraryImport("gdi32.dll")] private static partial int GetObjectW(nint bitmap, int size, out Bitmap info);
    [LibraryImport("gdi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool DeleteObject(nint item);
}
