# Flatpak

The Linux x86-64 Flatpak is distributed through [GitHub Releases](https://github.com/jasonunbrokensoftware/headroom/releases/latest). It is not a Flathub listing. The package contains the Native AOT executable, desktop entry, Graphite icon, tray libraries, and license notices. It uses the GNOME 51 runtime for GTK and WebKit, and requires an installed host Codex CLI.

## Install

Download `Headroom-1.1.0-x86_64.flatpak`, then run:

```sh
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user ./Headroom-1.1.0-x86_64.flatpak
flatpak run io.github.jasonunbrokensoftware.Headroom
```

The application menu also launches Headroom. Runtime dependencies are downloaded during installation if needed. No launcher script, separate .NET runtime, Python, or Node.js is needed to run the app.

To update a GitHub bundle, download the new version and install it with `flatpak install --user --reinstall ./Headroom-VERSION-x86_64.flatpak`. Updates preserve the private application data. This single-file distribution does not configure an automatic Headroom update repository.

## Codex and permissions

Headroom uses `flatpak-spawn --host` to run Codex installed on the computer. Common desktop-package and standalone locations are detected automatically; set `codexPath` in Headroom's settings to an absolute host executable path for other installations, such as a custom npm prefix. Codex is not bundled or downloaded by Headroom.

The package grants `org.freedesktop.Flatpak` host-command access. This permission allows commands outside the sandbox; Headroom uses it for the installed Codex CLI and its own optional startup entry. Each CLI process receives only its isolated Headroom account directory and selected environment variables. API-key environment variables are not inherited. Monitoring sends no model prompts.

Other permissions provide network access, Wayland/X11 display access, graphics acceleration, and the StatusNotifier tray. There is no general home-directory filesystem grant. The packaged tray libraries provide the same Open, Refresh, Start at login, About, and Quit actions as the standalone Linux build. Start at login writes a per-user entry named `io.github.jasonunbrokensoftware.Headroom.desktop` which launches `flatpak run ... --background`.

The Flatpak disables WebKit's DMA-BUF renderer to avoid the reproduced [NVIDIA/Wayland explicit-sync crash](https://bugs.webkit.org/show_bug.cgi?id=324551). This setting is confined to the package. Desktop tests cover actual rendering and decoration negotiation in an isolated KDE compositor.

## Data and portable account import

The Flatpak's writable root is:

```text
~/.var/app/io.github.jasonunbrokensoftware.Headroom/data/headroom/
  settings.json
  data/
```

The installed `/app/bin/Headroom` is read-only. Standalone Windows and Linux builds continue storing everything beside their executable.

To import a portable installation, fully quit Headroom first and copy its `settings.json` and `data/` into the Flatpak root above. Omit `data/instance.json`, `data/instance.lock`, and the Windows webview cache. Set `codexPath` to `null` if it contains a Windows path. Set `startWithWindows` to `false` in the copied settings, then enable **Start at login** from the Flatpak tray if desired; that JSON key is retained for compatibility on both platforms.

The data contains sign-in credentials and must remain private. Copying preserves account IDs, file-based sign-ins, and recorded history. Separate installations then collect their own history files; they observe account-wide usage but do not synchronize local files. The original portable installation is not modified by Flatpak installation or updates.

## Build and test

The packaging helper is tested on Fedora 45 x86-64. Publish Headroom as described in [the Linux guide](linux.md). Install `flatpak`, `ostree`, the GNOME 51 SDK/runtime, and Fedora's `libappindicator-gtk3` and `libdbusmenu-gtk3` packages. Download their matching source RPMs:

```sh
flatpak install --user flathub org.gnome.Sdk//51 org.gnome.Platform//51
mkdir -p artifacts/flatpak-sources
dnf download --source --destdir artifacts/flatpak-sources libappindicator-gtk3 libdbusmenu
HEADROOM_FLATPAK_SOURCES="$PWD/artifacts/flatpak-sources" bash tools/Build-Flatpak.sh
```

The helper packages only explicitly selected executable, metadata, icon, library, license, and source files. It does not copy accounts or settings. Each tray library's source-RPM name must match its installed binary package. The exact corresponding sources are included under `/app/share/headroom/sources/`; licenses are under `/app/share/licenses/`. GNOME runtime libraries remain runtime dependencies.

After installing the resulting bundle:

```sh
flatpak run io.github.jasonunbrokensoftware.Headroom --self-test --integration-test
node tests/flatpak.mjs
HEADROOM_FLATPAK_TEST=1 bash tools/Test-Linux-Desktop.sh kwin
```

The first command checks startup-entry creation/removal in a temporary directory and an isolated Codex sign-in handshake/cancellation. The API tests check private settings, account persistence, authentication, and restart. Desktop tests use a private Wayland display and D-Bus session. To additionally validate an existing portable installation through temporary private copies, set `HEADROOM_TEST_PORTABLE` to its absolute directory when running `tests/flatpak.mjs`; it deletes only the newly created test copies after shutdown.
