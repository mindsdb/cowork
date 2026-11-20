#!/usr/bin/env bash
# Run after npm ci and COWORK_ENV=staging npm run sync:ios.
set -euo pipefail
cd "$(dirname "$0")/.."

devices=$(xcrun simctl list devices available -j)
udid=$(python3 -c '
import json, sys
devices = json.load(sys.stdin)["devices"]
def version(runtime):
    return tuple(map(int, runtime.rsplit("iOS-", 1)[1].split("-")))
for runtime in sorted((r for r in devices if ".iOS-" in r), key=version, reverse=True):
    phones = [d for d in devices[runtime] if d["name"].startswith("iPhone")]
    if phones:
        phone = next((d for d in phones if d["state"] == "Booted"), phones[0])
        print(phone["udid"])
        break
else:
    sys.exit("Install an iOS Simulator runtime and create an iPhone in Xcode.")
' <<< "$devices")

output=${SIMULATOR_OUTPUT_DIR:-"${TMPDIR:-/tmp}/cowork-ios-smoke"}
mkdir -p "$output"
xcrun simctl bootstatus "$udid" -b
# Xcode embeds the simulator app identity during signing. Keychain session
# storage fails with errSecMissingEntitlement if signing is disabled.
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination "platform=iOS Simulator,id=$udid" -derivedDataPath "$output/DerivedData" \
  ONLY_ACTIVE_ARCH=YES build
bundle=ai.mindshub.cowork
app="$output/DerivedData/Build/Products/Release-iphonesimulator/App.app"
# Simulator entitlements live in the executable's Mach-O section.
xcrun segedit "$app/App" -extract __TEXT __entitlements "$output/simulator-entitlements.plist"
app_id=$(plutil -extract application-identifier raw "$output/simulator-entitlements.plist")
if [[ "$app_id" != *."$bundle" ]]; then
  echo "Missing Cowork simulator application identifier for Keychain access" >&2
  exit 1
fi
xcrun simctl install "$udid" "$app"
xcrun simctl launch "$udid" "$bundle"
xcrun simctl terminate "$udid" "$bundle"
xcrun simctl launch "$udid" "$bundle"
xcrun simctl io "$udid" screenshot "$output/iphone-launch.png"
