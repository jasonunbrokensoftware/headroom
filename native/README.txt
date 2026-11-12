Photino.Native 4.0.22 Windows sources, pinned to upstream commit
3ba4b937d6337b5c58344445db08a5a9a63f07c8 (tag v4.0.22):
https://github.com/tryphotino/photino.Native

License: photino/LICENSE (Apache 2.0). The upstream bundled WinToast and JSON
headers preserve their original license notices.

Headroom's change to Exports.cpp disables dllexport for PHOTINO_STATIC builds.
Headroom's changes to Photino.Windows.cpp defer visibility in static builds:
Headroom.Window.cpp composes the initial WebView under DWMWA_CLOAK with temporary
TOOLWINDOW/NOACTIVATE styles. Vue reports its first painted account/error view,
then the adapter restores normal styles and either reveals the window or leaves
it hidden for --background. No minimize/restore cycle or startup focus theft.
The rendering probe uses an isolated, cloaked HWND and WebView profile; it checks
actual first-contentful-paint and hidden completion without showing desktop UI.
Microsoft documents that cloaked windows remain composed but invisible:
https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute
Photino.Static.vcxproj builds the Windows implementation as a static library.
WebView2 and WIL headers are restored from pinned NuGet packages by Headroom.
Native AOT DirectPInvoke links this library and WebView2LoaderStatic.lib into
Headroom.exe. Neither native library is extracted or loaded as a sidecar DLL.
The installed WebView2 Runtime and normal Windows system libraries remain OS
dependencies. Linux retains its existing Photino package and GTK path.

Headroom.Taskbar.cpp keeps Windows shell COM calls inside the statically linked
adapter. It synchronizes this EXE's existing taskbar pins and window relaunch
metadata with the selected icon. Its regression probe uses only scratch links
and a message-only window. No visible UI, re-pinning, or Explorer restart.
