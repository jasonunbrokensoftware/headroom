using System.Runtime.InteropServices;

namespace Headroom;

internal static partial class NativeDesktop
{
    [LibraryImport("Photino.Native", EntryPoint = "Headroom_WebViewRuntimeAvailable")]
    internal static partial int WebViewRuntimeAvailable();
}
