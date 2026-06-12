# Generate, Sign, and Notarize the DMG (macOS)

This document explains the workflow to generate the custom macOS installer:

- Custom DMG: `release/MindsHub Cowork-<version>-universal-custom.dmg`
- Signing identity: `Developer ID Application`
- Notarization tool: `notarytool`

## 1. Prerequisites

1. A valid certificate in Keychain:
   - `Developer ID Application: MindsDB Inc (498Y665994)`
2. Verify the identity:

```bash
security find-identity -v -p codesigning
```

It must show at least one valid `Developer ID Application` identity.

3. Apple notarization credentials:
   - `APPLE_ID`
   - `APPLE_TEAM_ID`
   - App-specific password

## 2. Generate the signed custom DMG

The official repository workflow is:

```bash
npm run dist:mac:dmg-custom
```

This script:

1. Builds the app (`npm run build`)
2. Generates the DMG background image
3. Builds a signed universal `.app` bundle (without notarizing at this step)
4. Verifies the `.app` signature with `codesign --verify`
5. Packages the custom DMG with `appdmg`

Expected output:

- `release/MindsHub Cowork-<version>-universal-custom.dmg`

## 3. Notarize the custom DMG (manual)

Use `notarytool` manually (recommended for better retry control):

```bash
xcrun notarytool submit "release/MindsHub Cowork-0.1.0-universal-custom.dmg" \
  --apple-id "user@mindsdb.com" \
  --team-id "498Y665994" \
  --password "<APP_SPECIFIC_PASSWORD>" \
  --wait
```

If you prefer a non-blocking flow, omit `--wait` and poll status:

```bash
xcrun notarytool info <SUBMISSION_ID> \
  --apple-id "user@mindsdb.com" \
  --team-id "498Y665994" \
  --password "<APP_SPECIFIC_PASSWORD>"
```

## 4. Staple and final validation

When status is `Accepted`:

```bash
xcrun stapler staple "release/MindsHub Cowork-0.1.0-universal-custom.dmg"
xcrun stapler validate "release/MindsHub Cowork-0.1.0-universal-custom.dmg"
```

Validate the app inside the mounted DMG:

```bash
hdiutil attach "release/MindsHub Cowork-0.1.0-universal-custom.dmg"
spctl -a -vvv -t execute "/Volumes/MindsHub Cowork Installer 0.1.0/MindsHub Cowork.app"
codesign -dv --verbose=4 "/Volumes/MindsHub Cowork Installer 0.1.0/MindsHub Cowork.app"
hdiutil detach "/Volumes/MindsHub Cowork Installer 0.1.0"
```

Expected result:

- `spctl`: `accepted`
- `source=Notarized Developer ID`

## 5. Troubleshooting

## `status: Invalid` during notarization

1. Fetch notarization log:

```bash
xcrun notarytool log <SUBMISSION_ID> \
  --apple-id "<APPLE_ID>" \
  --team-id "<TEAM_ID>" \
  --password "<APP_SPECIFIC_PASSWORD>"
```

2. If it reports unsigned binaries / missing timestamp / missing hardened runtime:
   - Rebuild the `.app` via `npm run dist:mac:dmg-custom`
   - Verify `MindsHub Cowork.app` signature before notarizing
   - Resubmit

## `status: In Progress` for too long

This is commonly an Apple service queue issue.

Recommended approach:

1. Poll status every 5-10 minutes with `notarytool info`
2. If it stays in progress for ~2+ hours, resubmit the same DMG and use the new submission id
3. Continue with whichever submission reaches `Accepted` first

## Credential security

- Do not store app-specific passwords in plain text scripts.
- If a password is exposed, revoke it in Apple ID and create a new one.
