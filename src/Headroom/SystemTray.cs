using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using Microsoft.Win32;

namespace Headroom;

[SupportedOSPlatform("windows")]
internal sealed unsafe partial class SystemTray : IDisposable
{
    private const uint CallbackMessage = 0x8002;
    private const uint MenuMessage = 0x8003;
    private static readonly ConcurrentDictionary<nint, SystemTray> Instances = new();
    private readonly nint window, icon;
    private readonly Action refresh, quit;
    private readonly uint taskbarCreated;
    private bool version4, menuPending;
    internal static int NativeDataSize => sizeof(NotifyIconData);
    public bool Available { get; private set; }
    public SystemTray(nint window, string iconFile, Action refresh, Action quit)
    {
        this.window = window; this.refresh = refresh; this.quit = quit;
        icon = LoadImageW(0, iconFile, 1, 32, 32, 0x10); // IMAGE_ICON, LR_LOADFROMFILE
        taskbarCreated = RegisterWindowMessageW("TaskbarCreated");
        Instances[window] = this;
        SetWindowSubclass(window, &Procedure, 2, 0);
        Add();
        try { ApplyStartup(PortableStorage.Settings().StartWithWindows); } catch { }
    }
    private NotifyIconData Data()
    {
        var data = new NotifyIconData { Size = (uint)sizeof(NotifyIconData), Window = window, Id = 1,
            Flags = 1 | 2 | 4 | 0x80, Callback = CallbackMessage, Icon = icon, Version = 4 };
        Copy("Headroom — monitoring account-wide usage", data.Tip, 128);
        return data;
    }
    private void Add()
    {
        var data = Data();
        Available = Shell_NotifyIconW(0, ref data); // NIM_ADD
        version4 = Available && Shell_NotifyIconW(4, ref data); // NIM_SETVERSION
    }
    public void Hide() { if (Available) ShowWindow(window, 0); }
    public void Show() { ShowWindow(window, IsIconic(window) ? 9 : 5); SetForegroundWindow(window); }
    internal static int NotificationAction(bool version4, uint notification) => version4
        ? notification switch { 0x400 or 0x401 => 1, 0x7b => 2, _ => 0 } // NIN_SELECT / NIN_KEYSELECT, WM_CONTEXTMENU
        : notification switch { 0x202 or 0x203 => 1, 0x205 => 2, _ => 0 }; // Legacy mouse notifications only.
    private void QueueMenu()
    {
        // Leave the shell callback before entering a popup's nested message loop.
        if (menuPending) return;
        menuPending = true;
        if (!PostMessageW(window, MenuMessage, 0, 0)) menuPending = false;
    }
    private void Menu()
    {
        nint menu = CreatePopupMenu();
        if (menu == 0) return;
        uint command;
        try
        {
            AppendMenuW(menu, 0, 1, "Open Headroom");
            AppendMenuW(menu, 0, 2, "Refresh all accounts");
            AppendMenuW(menu, PortableStorage.Settings().StartWithWindows ? 8u : 0u, 3, "Start with Windows");
            AppendMenuW(menu, 0x800, 0, null);
            AppendMenuW(menu, 0, 4, "Quit Headroom");
            GetCursorPos(out var point);
            SetForegroundWindow(window);
            command = TrackPopupMenuEx(menu, 0x182, point.X, point.Y, window, 0); // RETURNCMD | NONOTIFY | RIGHTBUTTON
            PostMessageW(window, 0, 0, 0);
        }
        finally { DestroyMenu(menu); }
        // Dismiss first, then apply the selection. Reopening reads the saved check state.
        switch (command)
        {
            case 1: Show(); return;
            case 2: refresh(); break;
            case 3:
                var settings = PortableStorage.Settings();
                bool enabled = !settings.StartWithWindows;
                try { ApplyStartup(enabled); PortableStorage.UpdateSettings(current => current with { StartWithWindows = enabled }); }
                catch (Exception ex)
                {
                    try { PortableStorage.UpdateSettings(current => current with { StartWithWindows = settings.StartWithWindows }); ApplyStartup(settings.StartWithWindows); } catch { }
                    MessageBoxW(window, "Could not change startup: " + ex.Message, "Headroom", 0x10);
                }
                break;
            case 4: quit(); return;
        }
        var data = Data();
        Shell_NotifyIconW(3, ref data); // NIM_SETFOCUS: return focus after the tray menu closes.
    }
    private static void ApplyStartup(bool enabled)
    {
        // This is an OS launch registration. The preference itself lives beside the EXE.
        using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
        if (enabled) key.SetValue("Headroom", "\"" + Environment.ProcessPath + "\" --background", RegistryValueKind.String);
        else key.DeleteValue("Headroom", false);
    }
    [UnmanagedCallersOnly(CallConvs = [typeof(CallConvStdcall)])]
    private static nint Procedure(nint hwnd, uint message, nuint wParam, nint lParam, nuint id, nuint data)
    {
        try
        {
            if (Instances.TryGetValue(hwnd, out var tray))
            {
                if (message == tray.taskbarCreated) tray.Add();
                if (message == CallbackMessage)
                {
                    uint action = (uint)((long)lParam & 0xffff);
                    switch (NotificationAction(tray.version4, action))
                    {
                        case 1: tray.Show(); break;
                        case 2: tray.QueueMenu(); break;
                    }
                    return 0;
                }
                if (message == MenuMessage)
                {
                    try { tray.Menu(); }
                    finally { tray.menuPending = false; }
                    return 0;
                }
            }
        }
        catch { } // Never unwind across a native window callback.
        return DefSubclassProc(hwnd, message, wParam, lParam);
    }
    public void Dispose()
    {
        var data = Data(); Shell_NotifyIconW(2, ref data);
        RemoveWindowSubclass(window, &Procedure, 2);
        Instances.TryRemove(window, out _);
        if (icon != 0) DestroyIcon(icon);
        Available = false;
    }
    private static void Copy(string text, char* destination, int length)
    { for (int i = 0; i < Math.Min(text.Length, length - 1); i++) destination[i] = text[i]; }
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct NotifyIconData
    {
        public uint Size; public nint Window; public uint Id, Flags, Callback; public nint Icon;
        public fixed char Tip[128]; public uint State, StateMask; public fixed char Info[256];
        public uint Version; public fixed char InfoTitle[64]; public uint InfoFlags; public Guid Guid; public nint BalloonIcon;
    }
    [LibraryImport("shell32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool Shell_NotifyIconW(uint message, ref NotifyIconData data);
    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16)] private static partial nint LoadImageW(nint instance, string name, uint type, int width, int height, uint flags);
    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16)] private static partial uint RegisterWindowMessageW(string name);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool ShowWindow(nint window, int command);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool IsIconic(nint window);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool SetForegroundWindow(nint window);
    [LibraryImport("user32.dll")] private static partial nint CreatePopupMenu();
    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16)] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool AppendMenuW(nint menu, uint flags, nuint id, string? text);
    [LibraryImport("user32.dll")] private static partial uint TrackPopupMenuEx(nint menu, uint flags, int x, int y, nint window, nint parameters);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool DestroyMenu(nint menu);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool DestroyIcon(nint icon);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool GetCursorPos(out Point point);
    [LibraryImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool PostMessageW(nint window, uint message, nint wParam, nint lParam);
    [LibraryImport("user32.dll", StringMarshalling = StringMarshalling.Utf16)] private static partial int MessageBoxW(nint window, string text, string caption, uint type);
    [LibraryImport("comctl32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool SetWindowSubclass(nint window, delegate* unmanaged[Stdcall]<nint, uint, nuint, nint, nuint, nuint, nint> callback, nuint id, nuint data);
    [LibraryImport("comctl32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static partial bool RemoveWindowSubclass(nint window, delegate* unmanaged[Stdcall]<nint, uint, nuint, nint, nuint, nuint, nint> callback, nuint id);
    [LibraryImport("comctl32.dll")] private static partial nint DefSubclassProc(nint window, uint message, nuint wParam, nint lParam);
}
