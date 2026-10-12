#!/usr/bin/env bash
# Regenerate the macOS .icns app icons from the 1024px source PNGs (macOS only).
#
# The mac build is pointed at these .icns files instead of the PNGs. Given a
# PNG, electron-builder writes the 16/32/64px sizes as icp4/icp5/icp6 entries
# holding PNG data, and IconServices renders those as pixel noise — the garbled
# icon in Spotlight and Finder list view. iconutil writes the small sizes the
# way Apple's own icons store them (ic04/ic05 ARGB, ic11).
#
# Run after changing assets/icon*.png, then commit the regenerated .icns files:
#   scripts/generate-mac-icons.sh
set -euo pipefail

cd "$(dirname "$0")/../assets"

for name in icon icon-staging icon-preview; do
  work="$(mktemp -d)"
  set="$work/$name.iconset"
  mkdir "$set"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$name.png" --out "$set/icon_${size}x${size}.png" >/dev/null
    sips -z $((size * 2)) $((size * 2)) "$name.png" --out "$set/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$set" -o "$name.icns"
  rm -rf "$work"
  echo "wrote assets/$name.icns"
done
