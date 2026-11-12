# Linux

Headroom's Linux x64 executable uses the same Native AOT C# backend and Vue interface as Windows, with a statically linked Photino host using GTK 3 and WebKitGTK 4.1. It has a custom header, tray monitoring, startup at login, and an application-menu launcher. No Python, Node.js, separate .NET runtime, or launcher script is needed to run it.

Validated on Fedora 45 x64. Native desktop tests run on private Xvfb and headless Weston displays, never on the user's desktop. ARM64 and other distributions are not validated. Build on the oldest distribution you intend to support: a binary built on a newer glibc may not run on an older distribution.

## Build

Install the .NET 10 SDK and the native development dependencies. On Fedora, the relevant package names are:

```sh
sudo dnf install clang gcc-c++ binutils pkgconf-pkg-config gtk3-devel webkit2gtk4.1-devel libnotify-devel libX11-devel zlib-devel
```

From the repository root:

```sh
dotnet publish src/Headroom/Headroom.csproj -c Release -r linux-x64 -o artifacts/linux-native
```

Distribute only `artifacts/linux-native/Headroom`. Debug symbols and static-web-asset diagnostic files are not runtime dependencies. The build statically links Headroom's Photino adapter; it does not require `Photino.Native.so` alongside the executable. GTK/WebKit and their normal system dependencies remain dynamically linked. `ldd artifacts/linux-native/Headroom` identifies missing runtime libraries.

The runtime needs GTK 3, WebKitGTK 4.1, libnotify, X11 libraries (also when using Wayland), `xdg-open`, and Codex. On the tested Fedora machine, Codex bundled with the ChatGPT package is discovered at `/usr/lib/chatgpt/resources/codex`. A standalone `codex` on PATH or `~/.local/bin/codex` also works; `settings.json` can override discovery with `codexPath`.

## Install and use

Put `Headroom` in a writable folder, such as `~/.local/opt/headroom/`, and mark it executable. Use a path without percent signs: GIO does not correctly validate a percent-escaped executable path in desktop entries. Spaces, dollar signs, and quotes are supported. Run it normally to open the dashboard. From that folder, run:

```sh
./Headroom --install-desktop
```

This creates `headroom.desktop` under `$XDG_DATA_HOME/applications` (normally `~/.local/share/applications`). Its Exec field launches the ELF directly, with no shell. Re-run the command after moving the installation. Its Graphite icon is extracted from the executable into `data/icons/`.

On desktops with a StatusNotifier/AppIndicator tray, closing the window keeps monitoring active. The tray menu contains Open, Refresh, Start at login, About, and Quit. Install either Ayatana AppIndicator 3 or libappindicator 3 for this support. KDE Plasma supplies a tray host; other desktops may need an extension. A legacy GTK status icon is used when no indicator library is available. If no usable tray is detected, `--background` opens a window instead of leaving the application inaccessible, and closing the window quits it.

Start at login writes an XDG autostart entry under `$XDG_CONFIG_HOME/autostart` (normally `~/.config/autostart`) with `--background`. New installations leave this off. The portable preference retains its existing `startWithWindows` JSON key for compatibility; on Linux it means Start at login. Installing the launcher applies that preference, including when importing Windows settings.

The dashboard waits for its initial account/error view to paint before it is revealed. In background mode it remains hidden until opened from the tray. Browser sign-in is separate from the embedded dashboard. WebKit uses an ephemeral profile; settings, authentication, and monitoring history remain in the portable backend files.

## Copy accounts from Windows

Copy `settings.json` and `data/` privately beside the Linux executable. Do not copy the Windows EXE or a live `data/instance.json` / `data/instance.lock`. If `codexPath` points to a Windows executable, change it to `null` in the Linux copy. Keep the destination folder private (`chmod 700` on the installation folder), and never commit credentials or share the portable data archive.

File-based portable sign-ins and allowance history are shared formats; no Linux keyring conversion is needed. Copying does not alter the source installation. Each installation then records its own account-wide readings; local history files are not synchronized between computers. Both observe usage from all machines through the service. Credentials can still expire or require signing in again normally.

## Tests

These commands use temporary fixtures and do not sign in to a real account or send model prompts:

```sh
artifacts/linux-native/Headroom --self-test --integration-test
HEADROOM_TEST_EXE="$PWD/artifacts/linux-native/Headroom" node tests/backend.mjs
node tests/ui.mjs
node tests/totals.mjs
node tests/history.mjs
```

The native desktop tests additionally require Node.js, GIO development headers, D-Bus, Xvfb, and Weston (with its headless backend and kiosk shell). They create their own display, runtime directory, and D-Bus session:

```sh
bash tools/Test-Linux-Desktop.sh x11
bash tools/Test-Linux-Desktop.sh wayland
bash tools/Test-Linux-Desktop.sh kwin
```

The optional `kwin` mode requires `kwin_wayland` and runs a separate virtual KDE compositor with private settings. It verifies actual Wayland protocol requests use client decorations, so KDE does not add a duplicate title bar.

These tests exercise real WebKit/Vue startup, the pre-paint visibility gate, foreground and background launches, tray registration and actions, About activation, startup preference persistence, no-tray fallback, and the generated launcher through GIO. The suite uses no desktop automation or screen capture. It does not replace manual testing of compositor-specific window gestures or visual rendering on every distribution.

`HEADROOM_TEST_EXE` can select another published binary. `HEADROOM_NATIVE_CFLAGS`, `CXX`, `PKG_CONFIG_PATH`, and standard compiler/linker environment variables support development toolchains installed outside system directories. The test helper and native build script are development tools, not app launchers.
