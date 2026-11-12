#!/usr/bin/env bash
# Packages the published ELF; the app and desktop launcher execute native binaries.
set -euo pipefail
project=$(cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project"
id=io.github.jasonunbrokensoftware.Headroom
version=$(sed -n 's/.*<Version>\([^<]*\)<\/Version>.*/\1/p' src/Headroom/Headroom.csproj)
binary=${1:-"$project/artifacts/linux-native/Headroom"}
sources=${HEADROOM_FLATPAK_SOURCES:?Set HEADROOM_FLATPAK_SOURCES to the matching libappindicator and libdbusmenu source RPM directory}
test -x "$binary"
mkdir -p artifacts/flatpak
build=$(mktemp -d "$project/artifacts/flatpak/build.XXXXXX")
repo="$project/artifacts/flatpak/repo"
flatpak build-init --arch=x86_64 "$build" "$id" org.gnome.Sdk org.gnome.Platform 51
install -Dm755 "$binary" "$build/files/bin/Headroom"
install -Dm644 "packaging/flatpak/$id.desktop" "$build/files/share/applications/$id.desktop"
install -Dm644 "packaging/flatpak/$id.metainfo.xml" "$build/files/share/metainfo/$id.metainfo.xml"
install -Dm644 src/Headroom/Assets/headroom-graphite.png "$build/files/share/icons/hicolor/512x512/apps/$id.png"
install -Dm644 LICENSE "$build/files/share/licenses/headroom/LICENSE"
install -Dm644 THIRD_PARTY_NOTICES.md "$build/files/share/licenses/headroom/THIRD_PARTY_NOTICES.md"
install -Dm644 native/photino/LICENSE "$build/files/share/licenses/headroom/Photino-LICENSE"
install -Dm644 src/Headroom/VUE-LICENSE.txt "$build/files/share/licenses/headroom/Vue-LICENSE"
install -Dm644 src/Headroom/BouncyCastle-LICENSE.txt "$build/files/share/licenses/headroom/BouncyCastle-LICENSE"
# GNOME supplies GTK/WebKit. These three optional tray libraries are the only
# extra shared libraries. Include their exact Fedora source RPMs and licenses.
for library in libappindicator3.so.1 libdbusmenu-gtk3.so.4 libdbusmenu-glib.so.4; do
    location="/usr/lib64/$library"
    test -f "$location"
    source_rpm=$(rpm -qf "$location" --qf '%{SOURCERPM}')
    test -f "$sources/$source_rpm"
    install -Dm755 "$(readlink -f "$location")" "$build/files/lib/$library"
    install -Dm644 "$sources/$source_rpm" "$build/files/share/headroom/sources/$source_rpm"
done
for license in /usr/share/doc/libappindicator-gtk3/COPYING* /usr/share/licenses/libdbusmenu/COPYING*; do
    component=$(basename "$(dirname "$license")")
    install -Dm644 "$license" "$build/files/share/licenses/$component/$(basename "$license")"
done
flatpak build-finish --command=Headroom --share=network --share=ipc \
    --socket=wayland --socket=fallback-x11 --device=dri \
    --env=WEBKIT_DISABLE_DMABUF_RENDERER=1 \
    --talk-name=org.freedesktop.Flatpak --talk-name=org.kde.StatusNotifierWatcher "$build"
# Use a fixed reserve for this disposable build repo, rather than reserving
# three percent of a potentially very large filesystem for a small package.
if [[ ! -f "$repo/config" ]]; then ostree --repo="$repo" init --mode=archive-z2; fi
ostree --repo="$repo" config set core.min-free-space-percent 0
ostree --repo="$repo" config set core.min-free-space-size 1GB
flatpak build-export --arch=x86_64 "$repo" "$build" stable
bundle="$project/artifacts/Headroom-$version-x86_64.flatpak"
flatpak build-bundle --arch=x86_64 --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo \
    "$repo" "$bundle" "$id" stable
sha256sum "$bundle"
