Photino.Native 4.0.22 Windows and Linux sources, pinned to upstream commit
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
dependencies.

Linux builds compile the pinned Photino.Linux.cpp and Photino.Linux.Dialog.cpp
with Headroom.Linux.cpp into a static archive via tools/Build-Native-Linux.sh.
Native AOT DirectPInvoke links the adapter into one ELF executable, with no
Photino.Native.so sidecar. GTK 3, WebKitGTK 4.1, libnotify, and X11 remain normal
system dependencies. AppIndicator support is discovered dynamically at runtime.
Headroom's Linux changes use an ephemeral WebKit profile, set the application
identity, and defer window visibility until Vue's initial view has painted.
The Linux adapter registers a hidden custom GTK titlebar before realization to
announce client-side decorations on Wayland. Simply setting decorated=false
leaves GTK requesting a KDE server titlebar, duplicating Vue's custom header.
GTK's supported API is documented here:
https://docs.gtk.org/gtk3/method.Window.set_titlebar.html
The adapter adds the GTK/AppIndicator tray, background activation, and optional
test hooks exercised only on isolated Xvfb/Weston/KWin displays with a private
D-Bus. KWin tests inspect the actual Wayland decoration protocol requests.

Headroom.Taskbar.cpp keeps Windows shell COM calls inside the statically linked
adapter. It synchronizes this EXE's existing taskbar pins and window relaunch
metadata with the selected icon. Its regression probe uses only scratch links
and a message-only window. No visible UI, re-pinning, or Explorer restart.
