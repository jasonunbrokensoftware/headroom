#!/usr/bin/env bash
# Development build helper. The application itself is a native executable.
set -euo pipefail
project=$(cd -- "$(dirname -- "$0")/.." && pwd)
output="$project/native/obj/linux-$(uname -m)"
mkdir -p "$output"
packages=(gtk+-3.0 webkit2gtk-4.1 libnotify x11)
read -ra cflags <<< "$(pkg-config --cflags "${packages[@]}")"
read -ra extra <<< "${HEADROOM_NATIVE_CFLAGS:-}"
objects=()
for source in photino/Exports.cpp photino/Photino.Linux.cpp photino/Photino.Linux.Dialog.cpp Headroom.Linux.cpp; do
    object="$output/$(basename "${source%.cpp}").o"
    "${CXX:-g++}" -std=c++17 -O2 -fPIC -ffunction-sections -fdata-sections -DPHOTINO_STATIC \
        -Wno-deprecated-declarations "${cflags[@]}" "${extra[@]}" -c "$project/native/$source" -o "$object"
    objects+=("$object")
done
ar rcs "$output/Photino.Static.a" "${objects[@]}"
pkg-config --libs "${packages[@]}" > "$output/link.rsp"
printf '%s\n' '-lstdc++ -ldl' >> "$output/link.rsp"
