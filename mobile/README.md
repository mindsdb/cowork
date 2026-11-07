# MindsHub Cowork for iOS and Android

A thin [Capacitor](https://capacitorjs.com) 8 shell that loads the cloud web
app (`cowork.mindshub.ai`) in a native webview. Nothing runs on the phone: the
web code is the product, so every web deploy updates the app without a new
store release. Tracking ticket: [ENG-4023](https://linear.app/mindsdb/issue/ENG-4023).

This directory is self-contained. It has its own `package.json` and lockfile,
and nothing at the repo root (Electron build, root `npm ci`, tsconfigs,
vitest, electron-builder) reads it.

## Layout

| Path | What |
|---|---|
| `capacitor.config.ts` | App id, remote URL, user agent, plugin config |
| `env.ts` | `COWORK_ENV` to URL table |
| `scripts/cap-copy-before.mjs` | `capacitor:copy:before` hook: writes `www/env.js` and `ios/App/Version.xcconfig` |
| `www/` | `webDir`: a placeholder `index.html` and the bundled `offline.html` |
| `assets/` | Icon and splash sources for `@capacitor/assets` |
| `ios/App/App.xcodeproj` | Xcode project, scheme `App`, Swift Package Manager (no CocoaPods, no workspace) |
| `ios/App/App/MindsHubAuthPlugin.swift` | iOS auth plugin |
| `ios/App/App/MainViewController.swift` | Registers local plugins |
| `ios/App/App/AppDelegate.swift` | Forwards the APNs device token to the push plugin |
| `ios/App/App/App.entitlements`, `App.Debug.entitlements` | `aps-environment` for Release (production) and Debug (development) |
| `android/` | Gradle project, application module `:app` |
| `android/app/src/main/java/ai/mindshub/cowork/` | `MainActivity` (also creates the push channel), `MindsHubAuthPlugin`, `MindsHubPushPlugin` |
| `android/app/src/main/res/drawable/ic_stat_cowork.xml` | White status-bar glyph for notifications, from the brand mark |

## Contract with the web app

The web app (`src/renderer/`) relies on these. Changing any of them is a
breaking change for the shell and needs a matching web change.

- **App id / bundle id / Android package:** `ai.mindshub.cowork`. App name: `MindsHub Cowork`.
- **Remote URL:** production `https://cowork.mindshub.ai`, staging
  `https://cowork.staging.mindshub.ai`. Only those two hosts stay in the
  webview (`server.allowNavigation`); any other link opens in the system
  browser. Cleartext is off.
- **User agent suffix:** `MindsHubCowork-iOS/<version>` and
  `MindsHubCowork-Android/<version>`, where `<version>` is the marketing
  version from `package.json` (CFBundleShortVersionString / versionName).
  `capacitor.config.ts` builds it from the same field the native projects use,
  so they can't drift.
- **`window.Capacitor.Plugins.MindsHubAuth.authenticate({ url, callbackScheme })`**
  returns `Promise<{ url: string }>`. See [Sign-in](#sign-in-mindshubauth).
- **Safe areas:** the webview draws under the status bar and home indicator
  (`ios.contentInset: 'never'`; edge-to-edge on Android, with Capacitor's
  `SystemBars` injecting `--safe-area-inset-*` CSS variables). The page pads
  itself with `env(safe-area-inset-*)`. The status bar follows the system
  light/dark setting.
- **Bundled plugins:** `@capacitor/app`, `@capacitor/haptics`,
  `@capacitor/push-notifications`, `@capacitor/share`,
  `@capacitor/splash-screen`, `@capacitor/status-bar`.
- **`window.Capacitor.Plugins.PushNotifications`** (the stock plugin) and, on
  Android only, **`window.Capacitor.Plugins.MindsHubPush.isSupported()`**
  returning `{ supported: boolean }`. See [Push notifications](#push-notifications).

## Run it locally

Needs Xcode 26+ for iOS and Android Studio (JDK 21, Android SDK 36) for Android.
Node 22+ (Capacitor 8's CLI requires it).

```sh
cd mobile
npm ci
npx cap sync            # both platforms; or `npx cap sync ios`
npx cap open ios        # opens ios/App/App.xcodeproj in Xcode, then Run
npx cap open android    # opens android/ in Android Studio, then Run
```

Always build after a `cap sync`: it copies `www/`, writes the generated
`capacitor.config.json` into each native project and runs the copy hook.

### Choosing the environment

`COWORK_ENV` is read at sync time; the default is **staging**.

```sh
COWORK_ENV=prod npx cap sync      # https://cowork.mindshub.ai
COWORK_ENV=staging npx cap sync   # https://cowork.staging.mindshub.ai (default)
```

Anything else fails the sync. The value is baked into the native projects'
`capacitor.config.json` and `www/env.js`, so re-sync after switching.

### Versioning

- **Marketing version:** `version` in `mobile/package.json` (`MAJOR.MINOR.PATCH`).
- **Build number / versionCode:** `COWORK_BUILD_NUMBER` (CI sets the run number), default `1`.

Where they land:

- **iOS:** the copy hook writes `ios/App/Version.xcconfig`
  (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`). It is the Release base
  configuration and is `#include`d by `ios/debug.xcconfig`; `Info.plist` reads
  `$(MARKETING_VERSION)` and `$(CURRENT_PROJECT_VERSION)`. You can also override
  either on the `xcodebuild` command line.
- **Android:** `android/app/build.gradle` reads `versionName` from
  `package.json` and `versionCode` from `COWORK_BUILD_NUMBER` or
  `-PcoworkBuildNumber=<n>`.

### Icons and splash

Generated by `@capacitor/assets` from `assets/` (rendered from the desktop
`assets/icon.svg` brand mark, full-bleed on `#0E1518`). To regenerate:

```sh
npx @capacitor/assets generate --ios --android \
  --iconBackgroundColor '#0E1518' --iconBackgroundColorDark '#0E1518' \
  --splashBackgroundColor '#0E1518' --splashBackgroundColorDark '#0E1518'
```

## Offline and error screen

`server.errorPath` points to `www/offline.html`. When the remote page fails to
load (no network, DNS, TLS, or an HTTP error on the main document on Android),
Capacitor loads that bundled page instead of leaving a blank webview. Its
**Try again** button, and the browser's `online` event, navigate back to the
remote URL from `www/env.js`. The page has no access to Capacitor plugins on
Android, so it uses none.

## Sign-in (MindsHubAuth)

Sign-in uses the same Keycloak PKCE flow as the desktop app, in a real system
browser so Google sign-in and saved passwords work:

1. The web app builds the Keycloak authorize URL with
   `redirect_uri=ai.mindshub.cowork://auth/callback` and calls
   `MindsHubAuth.authenticate({ url, callbackScheme: 'ai.mindshub.cowork' })`.
2. **iOS:** `ASWebAuthenticationSession` (non-ephemeral, so it shares Safari's
   cookies) shows the page in a sheet anchored to the app window. When Keycloak
   redirects to the callback scheme the sheet closes and the promise resolves
   with `{ url }`, the full callback URL. Closing the sheet rejects with code
   `CANCELLED`.
3. **Android:** the URL opens in a Custom Tab (`androidx.browser`). The
   redirect hits `MainActivity`'s intent filter (`ai.mindshub.cowork://auth`),
   and `handleOnNewIntent` resolves with `{ url }`. If the user comes back to
   the app without a callback (closes the tab), the call rejects with
   `CANCELLED` after a short grace period.
4. The web app's keycloak-js shell adapter exchanges the code for tokens.

Other rejection codes: `IN_PROGRESS` (a sign-in is already open),
`INVALID_ARGUMENT` (missing or non-http(s) `url`, missing `callbackScheme`),
`FAILED`.

The scheme `ai.mindshub.cowork` is also registered in `Info.plist`
(`CFBundleURLTypes`). On Android, if the OS kills the app while the Custom Tab
is open, the pending call is lost; the callback then arrives as a normal app
launch (`@capacitor/app`'s `appUrlOpen` / `getLaunchUrl`).

Local plugins aren't found by `cap sync`, so they are registered by hand:
`MainViewController.capacitorDidLoad()` on iOS (the scene delegate and
`Main.storyboard` both use `MainViewController`), and
`registerPlugin(MindsHubAuthPlugin.class)` before `super.onCreate` in
`MainActivity` on Android. Capacitor injects its bridge into the remote
`server.url` page, so the page sees `window.Capacitor.Plugins.MindsHubAuth`.

## Push notifications

The app notifies the user when a task finishes, when a scheduled task run
finishes, and when someone shares an artifact with them. Tapping a
notification opens the task (or the scheduled task) in the app, or the shared
artifact's page in the system browser.

### How it fits together

1. The web app (`src/renderer/lib/mobilePush.ts`) talks to
   `@capacitor/push-notifications` through the bridge. It never fires the OS
   permission prompt at launch. If notifications are already allowed, it
   registers right after sign-in. Otherwise it waits until the user starts
   their first task and shows a small in-app card ("Get notified when your
   tasks finish", **Turn on** / **Not now**). **Turn on** fires the OS prompt.
   **Not now** hides the card for 14 days.
2. The plugin hands back a token: the **APNs device token** on iOS (not an
   FCM token) and the **FCM registration token** on Android. The web app sends
   it to the server: `POST /api/v1/push/devices`
   `{ token, platform: 'ios'|'android', app_version, environment: null }`.
   It sends each user and token pair once per session. If a server has no
   push (`404`, `405`, `501`), the web app stops quietly.
3. The server (cowork-server) sends through APNs or FCM. The payload carries
   `kind` (`task_finished`, `scheduled_run_finished` or `artifact_shared`),
   optional `path` (an in-app route such as `/c/<conversationId>`) and
   optional `url` (a page outside the app). On iOS these are APNs custom keys
   beside `aps`. On Android they are the FCM `data` map, next to a
   `notification` block. Without the `notification` block, Android shows
   nothing while the app is in the background.
4. **A tap** opens `path` with the app's router. If there is no `path`, it
   opens `url` in the system browser (a host outside `server.allowNavigation`
   always leaves the webview). A tap that launches the app arrives before
   the router exists, and often before sign-in, which reloads the page. The
   web app keeps the tap in `sessionStorage` for 10 minutes and applies it
   once the router mounts.
5. **Sign-out** sends `DELETE /api/v1/push/devices` `{ token }` before the
   Keycloak tokens are cleared. It is best effort and waits at most 3 seconds.
   The OS registration is kept: `PushNotifications.unregister()` would turn
   remote notifications off for the app (iOS) or delete the FCM token
   (Android), and the next user to sign in on the phone registers the same
   token as theirs.

**Foreground:** `capacitor.config.ts` sets
`PushNotifications.presentationOptions: ['banner', 'list', 'sound']`. A push
that arrives while the app is open still shows a banner. The option is static
native config, so it can't hide the banner for the one conversation that is on
screen. Hiding every foreground push would also hide shares and other tasks.
No `badge`: nothing would ever clear it.

### iOS

- `AppDelegate` forwards `didRegisterForRemoteNotificationsWithDeviceToken`
  and `didFailToRegisterForRemoteNotificationsWithError` to the plugin through
  `NotificationCenter` (`.capacitorDidRegisterForRemoteNotifications`), as
  Capacitor 8 requires.
- Entitlements: Release signs with `App/App.entitlements`
  (`aps-environment = production`). Debug signs with `App/App.Debug.entitlements`
  (`development`, the APNs sandbox). The CI smoke build has
  `CODE_SIGNING_ALLOWED=NO`, so it doesn't check them.
- **The App ID `ai.mindshub.cowork` needs the Push Notifications capability,
  and the App Store profile (`IOS_PROFILE_APP_B64`) must be regenerated after
  that.** `build-ios.yml` checks that the profile has
  `aps-environment = production` and fails early if it doesn't. Fastlane's
  `update_code_signing_settings` doesn't touch `CODE_SIGN_ENTITLEMENTS`.
- The backend needs an **APNs auth key** (`.p8`, its Key ID and the Team ID).
  It sends to `api.push.apple.com` for TestFlight and App Store builds, and to
  `api.sandbox.push.apple.com` for builds run from Xcode. The app sends
  `environment: null`, so the backend tries production and falls back to the
  sandbox on `BadDeviceToken`. The APNs topic is the bundle id,
  `ai.mindshub.cowork`.

### Android

- `@capacitor/push-notifications` uses Firebase Cloud Messaging. Firebase
  needs `android/app/google-services.json`, which is never committed. CI writes
  it from `GOOGLE_SERVICES_JSON_B64`, and `app/build.gradle` applies the
  google-services plugin only when the file is there.
- **Without that file the build still works, but push is off.** The plugin's
  `register()` would crash the app, because Firebase isn't initialized and
  Capacitor rethrows a plugin method's exception. So the web app first asks
  `MindsHubPush.isSupported()`, which checks for the `google_app_id` resource
  the google-services plugin generates, and does nothing when it is false.
  `build-android.yml` warns when the secret is missing.
- Android 13+ asks for `POST_NOTIFICATIONS` at runtime. The manifest declares
  it, and `requestPermissions()` asks for it.
- `MainActivity` creates the notification channel `cowork_updates` ("Task
  updates", high importance). The manifest makes it Firebase's default channel,
  with the small icon `@drawable/ic_stat_cowork` (the brand mark as a white
  glyph) and the accent color `#1F9CB0`.
- The backend needs an FCM service account for the HTTP v1 API, in the same
  Firebase project as `google-services.json`.

### Firebase setup

1. In the Firebase console, create a project, or use the MindsDB one, and add
   an Android app with package `ai.mindshub.cowork`.
2. Download `google-services.json`, then
   `base64 -i google-services.json | tr -d '\n'` into the
   `GOOGLE_SERVICES_JSON_B64` secret. For a local build, copy the file to
   `android/app/google-services.json` (it is gitignored).
3. Project settings -> Service accounts -> generate a private key. That JSON
   goes to the backend, not to this repo.

### Testing on a device

Simulators and emulators are limited. The iOS Simulator (iOS 16+ on an Apple
silicon Mac) gets a sandbox APNs token only from a signed Debug build, and the
quickest test there is to drop a payload on it:
`xcrun simctl push booted ai.mindshub.cowork payload.apns` with
`{"aps":{"alert":{"title":"Done","body":"Your task finished"}},"kind":"task_finished","path":"/c/<id>"}`.
That tests the tap and the routing, not delivery from the server. An Android
emulator needs a Google Play system image to get an FCM token.

End to end:

1. Install a TestFlight or Play internal build on a real phone, or run a Debug
   build from Xcode or Android Studio on a device (Debug iOS builds use the
   APNs sandbox).
2. Sign in, start a task, tap **Turn on**, and allow notifications.
3. Check that the server stored the token for your user. Then put the app in
   the background, let the task finish, and tap the notification. It should
   open `/c/<conversationId>`.
4. To try a cold start, swipe the app away, send a push, and tap it. The app
   should open on the task after you sign in.
5. Sign out. The server should have dropped the token, and a new push to it
   should no longer reach the phone for that user.

To send one by hand: on iOS, use the Push Notifications console in the Apple
Developer account (needs the device token). On Android, use Firebase console
-> Messaging -> "Send test message" with the FCM token.

## CI

`.github/workflows/mobile-smoke.yml` runs on PRs that touch `mobile/` (called
from `dev-build-deploy.yml`): an unsigned iOS simulator build (`xcodebuild
-scheme App -configuration Release -sdk iphonesimulator
CODE_SIGNING_ALLOWED=NO`), an Android `./gradlew assembleDebug`, and a
`bundleRelease` signed with a throwaway key to keep the release signing config
honest. Signed store builds are under [Releasing](#releasing).

## Releasing

`.github/workflows/mobile-release.yml` builds signed apps and hands them to
testers. It calls one workflow per platform, both driven by fastlane
(`fastlane/Fastfile`, run from `mobile/` with `bundle exec fastlane ...`):

| Workflow | Lane | Runner | Result |
|---|---|---|---|
| `.github/workflows/build-ios.yml` | `ios beta` | macOS, newest stable Xcode | `.ipa` uploaded to TestFlight |
| `.github/workflows/build-android.yml` | `android internal` | Ubuntu, JDK 21 | `.aab` uploaded to the Play internal testing track |

`mobile-release.yml` runs on:

- **A `mobile-v<version>` tag:** a **production** build (`cowork.mindshub.ai`)
  of both apps. The tag must equal `mobile-v` + `version` in `package.json`,
  or the run fails before building anything.
- **`workflow_dispatch`** (Actions -> Mobile release -> Run workflow, any
  branch): inputs `environment`, `staging` (default) or `prod`, and
  `platform`, `both` (default), `ios` or `android`.

The two platform jobs are independent; one failing doesn't stop the other.
The `.ipa` (with dSYMs) and `.aab` are kept as run artifacts.

The build number (iOS `CFBundleVersion`, Android `versionCode`) is the
`mobile-release.yml` run number, so it only goes up and is the same on both
platforms for one release. Re-running a run that already
uploaded reuses its number and the store rejects it; start a new run instead.

Staging and production builds use the same bundle id / package, so a staging
build in TestFlight or Play internal testing is the same app pointed at
`cowork.staging.mindshub.ai`. Installing one replaces the other. TestFlight's
"What to Test" note and the Play release name say which environment a build
is. (The iOS job waits for App Store Connect to finish processing, usually
5-15 minutes, because that note can only be set after processing.)

### Cutting a release

```sh
# 1. bump "version" in mobile/package.json (e.g. 1.0.1), merge it
# 2. tag the merged commit and push the tag
git tag mobile-v1.0.1 && git push origin mobile-v1.0.1
```

That builds and uploads both apps. Then, when the testers are happy, **promote by hand**:
App Store Connect (TestFlight build -> new App Store version -> submit for
review) and Play Console (internal testing -> promote to production or a wider
track). Automating promotion is a later step.

### Before the first run

The workflows check their secrets first and fail with the list of missing
names, so a run before the accounts exist fails in seconds and says what to add.

- **Play: the first upload must be manual.** A new Play app accepts API uploads
  only after one `.aab` has been uploaded by hand to internal testing. Run
  Mobile release once with `platform: android` (it fails at the upload step), download the `.aab`
  from the run's artifacts, and upload it in Play Console -> Testing -> Internal
  testing. Use a staging dispatch, or a prod one if that first build should be
  production. While the app is still a draft in Play Console, Play only accepts
  draft releases: set the repository **variable** `PLAY_RELEASE_STATUS=draft`
  until the first release is rolled out, then delete it (the default is
  `completed`, which makes a build available to internal testers right away;
  the internal track has no review).
- **iOS: the app record must exist** in App Store Connect for
  `ai.mindshub.cowork` before the first TestFlight upload.
- **iOS signing:** the Fastfile switches the `App` target to manual signing with
  the Apple Distribution identity and the installed profile, on the CI checkout
  only (`update_code_signing_settings`). The committed project stays on
  automatic signing for local development. If you run `fastlane ios beta`
  locally, discard the `project.pbxproj` change afterwards.

### Secrets

Repository secrets (Settings -> Secrets and variables -> Actions). Base64 values
are single-line: `base64 -i <file> | tr -d '\n' | pbcopy` on macOS,
`base64 -w0 <file>` on Linux.

**iOS** (read by `build-ios.yml`)

| Secret | What | How to produce it |
|---|---|---|
| `IOS_DIST_CERT_B64` | Apple Distribution certificate with its private key, `.p12` | Certificates, IDs & Profiles -> Certificates -> Apple Distribution (from a CSR made in Keychain Access). Install the `.cer`, export certificate + key from Keychain Access as `.p12` with a password, then base64 it. Not the Developer ID certificate the Mac app uses. |
| `IOS_DIST_CERT_PASSWORD` | The `.p12` export password | |
| `IOS_PROFILE_APP_B64` | App Store provisioning profile for `ai.mindshub.cowork` | Profiles -> Distribution -> App Store Connect, App ID `ai.mindshub.cowork` **with Push Notifications enabled**, the certificate above. Download the `.mobileprovision`, base64 it. Regenerate it (and this secret) when the certificate changes or capabilities are added. `build-ios.yml` fails if it has no `aps-environment = production`. |
| `IOS_PROFILE_SHARE_B64` | Profile for `ai.mindshub.cowork.share` | **Later**, with the share extension. Not read yet. |
| `ASC_API_KEY_ID` | App Store Connect API key id | Users and Access -> Integrations -> App Store Connect API -> Team Keys, role App Manager. |
| `ASC_API_ISSUER_ID` | Issuer id shown on that page | |
| `ASC_API_KEY_P8_B64` | The key's `AuthKey_<id>.p8` | Downloadable once. `base64 -i AuthKey_<id>.p8 \| tr -d '\n'`. |

The team id and profile name are read from the profile itself; no
`APPLE_TEAM_ID` is needed here.

**Android** (read by `build-android.yml`)

| Secret | What | How to produce it |
|---|---|---|
| `ANDROID_UPLOAD_KEYSTORE_B64` | Upload keystore | `keytool -genkeypair -v -keystore upload.jks -storetype PKCS12 -alias upload -keyalg RSA -keysize 2048 -validity 10000`, then base64 it. Keep the file and passwords in the team password manager; enroll in Play App Signing so a lost upload key can be reset. |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password | |
| `ANDROID_KEY_ALIAS` | Key alias (`upload` above) | |
| `ANDROID_KEY_PASSWORD` | Key password (same as the store password for PKCS12) | |
| `PLAY_SERVICE_ACCOUNT_JSON_B64` | Play Developer API service account key | Google Cloud -> IAM -> Service accounts -> create, Keys -> add JSON key. In Play Console -> Users and permissions, invite its email with release permissions for the app. Base64 the JSON. |
| `GOOGLE_SERVICES_JSON_B64` | Firebase config (optional) | Firebase -> project settings -> Android app `ai.mindshub.cowork` -> `google-services.json`, base64 it. When set, CI writes `android/app/google-services.json` and the google-services plugin is applied. When not, the build skips Firebase and has no push notifications (the workflow logs a warning). See [Push notifications](#push-notifications). |

Optional repository variable: `PLAY_RELEASE_STATUS` (`draft` until the Play
app's first release is out; see above).

### Signing locally

Android: the release `signingConfig` in `android/app/build.gradle` is used
only when a keystore path is given, from the environment
(`ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`) or Gradle properties (`coworkKeystorePath`,
`coworkKeystorePassword`, `coworkKeyAlias`, `coworkKeyPassword`, e.g. in
`~/.gradle/gradle.properties`). Without one, `bundleRelease` produces an
unsigned bundle and debug builds are unaffected.

## Not done yet (TODO)

- **Push follow-ups:** an in-app setting to turn push off for this phone (the
  web app's Settings has no notifications section yet; today it is the OS
  setting), and "needs your input" / "approval required" notifications.
- **Share extension** (`ai.mindshub.cowork.share`, App Group
  `group.ai.mindshub.cowork`): needs its App ID and provisioning profile.
- **Universal links / app links:** `apple-app-site-association` and
  `assetlinks.json` on `cowork.mindshub.ai`, plus Associated Domains.
- **Store promotion** is manual (App Store Connect, Play Console).
- **Keycloak** public client `cowork-mobile` (PKCE) with
  `ai.mindshub.cowork://auth/callback` as a redirect URI.

## Account and credential prerequisites (pending)

From [ENG-4023](https://linear.app/mindsdb/issue/ENG-4023), still to set up by
an account holder:

- Apple: App IDs (`ai.mindshub.cowork` with Push Notifications,
  `ai.mindshub.cowork.share`), Apple Distribution certificate, App Store
  provisioning profiles (made after Push is enabled), APNs auth key (for the
  backend), App Store Connect API key, app record and TestFlight groups.
- Google: Play Console organization account and app, upload keystore with Play
  App Signing, Firebase project (`google-services.json` for CI, FCM service
  account for the backend), Play Developer API service account.
- GitHub secrets: see [Secrets](#secrets).
