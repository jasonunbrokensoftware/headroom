using System.Runtime.InteropServices;

namespace Headroom;

internal static partial class NativeDesktop
{
    [LibraryImport("Photino.Native", EntryPoint = "Headroom_WebViewRuntimeAvailable")]
    internal static partial int WebViewRuntimeAvailable();
    [LibraryImport("Photino.Native", EntryPoint = "Headroom_SetTaskbarIcon", StringMarshalling = StringMarshalling.Utf16)]
    internal static partial int SetTaskbarIcon(nint window, string executable, string icon, string pinnedDirectory);
    [LibraryImport("Photino.Native", EntryPoint = "Headroom_ClearTaskbarIcon")]
    internal static partial void ClearTaskbarIcon(nint window);
    [LibraryImport("Photino.Native", EntryPoint = "Headroom_TestTaskbarIcons", StringMarshalling = StringMarshalling.Utf16)]
    internal static partial int TestTaskbarIcons(string directory, string executable, string firstIcon, string secondIcon);
}
