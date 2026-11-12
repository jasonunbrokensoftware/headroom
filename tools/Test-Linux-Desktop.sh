#!/usr/bin/env bash
# Development checks on a private display and D-Bus session. Never uses the desktop.
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
mode=${1:-x11}
case "$mode" in x11|wayland) ;; *) echo 'Usage: bash tools/Test-Linux-Desktop.sh [x11|wayland]' >&2; exit 2 ;; esac
mkdir -p .test-data
scratch=$(mktemp -d "$PWD/.test-data/linux-display.XXXXXX")
chmod 700 "$scratch"
read -ra cflags <<< "$(pkg-config --cflags gio-2.0)"
read -ra extra <<< "${HEADROOM_NATIVE_CFLAGS:-}"
read -ra libs <<< "$(pkg-config --libs gio-2.0)"
"${CXX:-g++}" -std=c++17 "${cflags[@]}" "${extra[@]}" tests/linux-tray-host.cpp -o "$scratch/tray-host" "${libs[@]}"
export HEADROOM_TRAY_TEST_HOST="$scratch/tray-host" HEADROOM_ISOLATED_DESKTOP=1
export XDG_RUNTIME_DIR="$scratch" XDG_CACHE_HOME="$scratch/cache" NO_AT_BRIDGE=1
unset DISPLAY WAYLAND_DISPLAY DBUS_SESSION_BUS_ADDRESS
if [[ "$mode" == x11 ]]; then
    Xvfb -displayfd 3 -screen 0 1280x900x24 -nolisten tcp -noreset 3>"$scratch/display" >"$scratch/display.log" 2>&1 &
    display_pid=$!
    trap 'kill "$display_pid" 2>/dev/null || true; wait "$display_pid" 2>/dev/null || true' EXIT
    for ((i=0; i<100; i++)); do [[ -s "$scratch/display" ]] && break; sleep .1; done
    if [[ ! -s "$scratch/display" ]]; then cat "$scratch/display.log"; exit 1; fi
    export DISPLAY=":$(cat "$scratch/display")" GDK_BACKEND=x11
else
    weston --backend=headless --shell=kiosk --renderer=pixman --socket=headroom-test \
        --idle-time=0 --no-config --width=1280 --height=900 >"$scratch/display.log" 2>&1 &
    display_pid=$!
    trap 'kill "$display_pid" 2>/dev/null || true; wait "$display_pid" 2>/dev/null || true' EXIT
    for ((i=0; i<100; i++)); do [[ -S "$scratch/headroom-test" ]] && break; sleep .1; done
    if [[ ! -S "$scratch/headroom-test" ]]; then cat "$scratch/display.log"; exit 1; fi
    export WAYLAND_DISPLAY=headroom-test GDK_BACKEND=wayland
fi
dbus-run-session -- node tests/linux-desktop.mjs
