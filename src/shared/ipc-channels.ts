export const IPC = {
  // Installer
  INSTALL_CHECK: 'install:check',
  INSTALL_START: 'install:start',
  INSTALL_LOG: 'install:log',
  INSTALL_PROGRESS: 'install:progress',
  INSTALL_DONE: 'install:done',
  INSTALL_ERROR: 'install:error',
  INSTALL_CANCEL: 'install:cancel',
  INSTALL_CANCELLED: 'install:cancelled',

  // Settings / Onboarding
  SETTINGS_READ: 'settings:read',
  SETTINGS_SAVE: 'settings:save',
  SETTINGS_CHECK_CONFIGURED: 'settings:check-configured',
  SETTINGS_VALIDATE: 'settings:validate',
  TERMS_ACCEPT: 'terms:accept',

  // UI Updates
  UI_UPDATE_CHECK: 'ui:update-check',
  UI_UPDATE_APPLY: 'ui:update-apply',
  UI_UPDATE_STATUS: 'ui:update-status',
  // Pull the last-known shell (installer) update status (ENG-849). The notice
  // is normally pushed via UI_UPDATE_STATUS, but an OTA reload re-mounts the
  // renderer and drops that push, so the renderer re-pulls this on mount.
  UI_SHELL_UPDATE_GET: 'ui:shell-update-get',

  // Shell auto-update lifecycle (ENG-850). Separate from the legacy
  // UI_UPDATE_STATUS channel so renderer reloads can pull one authoritative
  // snapshot rather than reconstructing state from transient phase strings.
  SHELL_UPDATE_GET: 'shell:update-get',
  SHELL_UPDATE_CHECK: 'shell:update-check',
  SHELL_UPDATE_DOWNLOAD: 'shell:update-download',
  SHELL_UPDATE_INSTALL: 'shell:update-install',
  SHELL_UPDATE_STATUS: 'shell:update-status',

  // Server
  SERVER_RESTART: 'server:restart',
  SERVER_UPDATE_STATUS: 'server:update-status',

  // Renderer awaits this before leaving the loading screen, so a boot-time
  // update (which restarts the sidecar) can't flash the chat UI first (ENG-749).
  BOOT_AWAIT_READY: 'boot:await-ready',

  // Auth
  AUTH_GET_ACCESS_TOKEN: 'auth:get-access-token',
  AUTH_LOGOUT: 'auth:logout',

  // Keychain — where the refresh token is stored (file vs macOS keychain)
  KEYCHAIN_PREF_GET: 'keychain:get',
  KEYCHAIN_PREF_SET: 'keychain:set',

  // OAuth — PKCE bridge + builtin connector flow
  OAUTH_CONNECT: 'oauth:connect',
  OAUTH_CANCEL: 'oauth:cancel',
  // Disconnect a builtin OAuth connection: stops the refresh loop,
  // deletes the keychain entry, and removes the vault record.
  KEYCHAIN_REVOKE: 'keychain:revoke',
  // Fired by the background token-refresh loop when consecutive failures hit
  // threshold (transient) or a 401 makes the refresh token permanently invalid.
  OAUTH_REFRESH_ERROR: 'oauth:refresh-error',
  // Runs the whole Google Picker flow: mints a short-lived access_token,
  // opens the picker in the OS browser (same loopback pattern as
  // OAUTH_CONNECT), and resolves with the files the user selected there.
  OAUTH_PICK_DRIVE_FILES: 'oauth:pick-drive-files',
  OAUTH_CANCEL_PICKER: 'oauth:cancel-picker',

  // MindsHub — split from oauth:connect so env writes only happen
  // after the user has chosen an LLM path (free users may never
  // commit Minds as the LLM if they go BYOK).
  MINDSHUB_LOGIN: 'mindshub:login',
  // Same loopback PKCE flow as MINDSHUB_LOGIN but entered through
  // Keycloak's registration form, with a callback window long enough to
  // survive the email-verification pause (ENG-917).
  MINDSHUB_SIGNUP: 'mindshub:signup',
  MINDSHUB_REFRESH: 'mindshub:refresh',
  MINDSHUB_FINALIZE: 'mindshub:finalize',
  MINDSHUB_GET_CACHED_TOKEN: 'mindshub:get-cached-token',
  // A MindsHub API key the user pasted in, instead of running on their
  // session credential. It goes to main rather than into the settings write
  // the rest of the form makes, because main is what stores it in the OS
  // keychain and hands it to the sidecar at runtime — keeping it out of
  // `.env`, out of `minds_api_key` and out of `providers_json`. An empty
  // value clears it and falls the app back to the session credential.
  MINDSHUB_SET_USER_KEY: 'mindshub:set-user-key',
  // Which MindsHub organization the credential this install presents names.
  // The read and the switch both live in main because the credential does:
  // the token store and the Keycloak switch are main-process, and the
  // renderer has no way to reach Keycloak (auth's CORS allowlist names
  // console origins only). Switching re-rolls the active-organization claim,
  // which is what the gateway reads to decide whose credits a turn spends.
  MINDSHUB_LIST_ORGS: 'mindshub:list-orgs',
  MINDSHUB_SWITCH_ORG: 'mindshub:switch-org',
  // Pushed main → renderer whenever the MindsHub token store changes
  // (login, silent refresh, logout, definitive session death). The
  // renderer's signed-in indicator subscribes to this instead of
  // depending solely on the promise of the sign-in call that happened
  // to initiate the flow (ENG-761: that promise can be lost — reload,
  // hung exchange — leaving the UI stuck on "Sign in" forever).
  MINDSHUB_AUTH_CHANGED: 'mindshub:auth-changed',

  // App
  APP_READY: 'app:ready',
  APP_GET_PLATFORM: 'app:get-platform',
  APP_UI_VERSION: 'app:ui-version',
  OPEN_EXTERNAL: 'app:open-external',
  SHOW_ITEM_IN_FOLDER: 'shell:show-item-in-folder',
  // Relaunches the whole app (app.relaunch + app.exit) — used after saving a
  // custom server URL/token, since that's read once at window-creation time
  // via additionalArguments, not hot-reloadable.
  APP_RESTART: 'app:restart',

  // Custom (remote) server — points the app at a cowork-server instance this
  // app didn't spawn, instead of the local loopback one. Stored in the same
  // ~/.cowork*/.env file as everything else main-process-local, under its
  // own keys (COWORK_CUSTOM_SERVER_URL / COWORK_CUSTOM_SERVER_TOKEN) —
  // deliberately separate from COWORK_AUTH_TOKEN, which the LOCAL server
  // generates/owns for itself.
  BACKEND_CUSTOM_SERVER_GET: 'backend:custom-server-get',
  BACKEND_CUSTOM_SERVER_SET: 'backend:custom-server-set',

  // Local server auth — toggles COWORK_REQUIRE_AUTH/COWORK_AUTH_TOKEN for the
  // sidecar THIS app spawns (see local-auth.ts). Off by default; enabling
  // generates a token, restarts the sidecar, and the client picks the token
  // up on its very next request (onBeforeSendHeaders reads it live).
  BACKEND_LOCAL_AUTH_GET: 'backend:local-auth-get',
  BACKEND_LOCAL_AUTH_SET: 'backend:local-auth-set',
  // Pushed main → renderer when the main window hides/minimizes (false) or
  // shows/restores/focuses (true). Electron 39 starts the renderer with
  // MacWebContentsOcclusion disabled, so on macOS `document.visibilityState`
  // never reports a hidden or minimized window; polling gates combine both.
  APP_WINDOW_VISIBILITY: 'app:window-visibility',

  // First-class Code workspace (independent from the parked Coding Mode MVP).
  CODE_PICK_FOLDER: 'code:pick-folder',

  // Coding mode (MVP) — detect a local `claude` CLI install, then run it in
  // a real PTY embedded in the app (a task view's ChatView, for a
  // claude-code-harness task) instead of the in-app anton chat.
  CODING_DETECT_CLI: 'coding:detect-cli',
  CODING_TERMINAL_START: 'coding:terminal-start',
  CODING_TERMINAL_DATA: 'coding:terminal-data',
  CODING_TERMINAL_INPUT: 'coding:terminal-input',
  CODING_TERMINAL_RESIZE: 'coding:terminal-resize',
  CODING_TERMINAL_EXIT: 'coding:terminal-exit',
  CODING_TERMINAL_IS_RUNNING: 'coding:terminal-is-running',
  CODING_TERMINAL_KILL: 'coding:terminal-kill',
  // Task deletion: stop its PTY host (if running) and remove its git
  // worktree/branch under <project>/.claude_tasks/<taskId>/.
  CODING_REMOVE_TASK: 'coding:remove-task',
} as const;
