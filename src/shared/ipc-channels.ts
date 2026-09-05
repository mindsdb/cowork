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
  // Recover the manual shell notice after an OTA remount loses its pushed event.
  UI_SHELL_UPDATE_GET: 'ui:shell-update-get',

  // Shell auto-update has a pullable snapshot so renderer reloads do not have to reconstruct
  // transient events.
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
  // Google Picker runs in the OS browser with a short-lived token and a loopback callback.
  OAUTH_PICK_DRIVE_FILES: 'oauth:pick-drive-files',
  OAUTH_CANCEL_PICKER: 'oauth:cancel-picker',

  // MindsHub login is separate from provider selection; signing in need not commit MindsHub as the
  // LLM.
  MINDSHUB_LOGIN: 'mindshub:login',
  // Registration uses PKCE with a callback window long enough for email verification.
  MINDSHUB_SIGNUP: 'mindshub:signup',
  MINDSHUB_REFRESH: 'mindshub:refresh',
  MINDSHUB_FINALIZE: 'mindshub:finalize',
  MINDSHUB_GET_CACHED_TOKEN: 'mindshub:get-cached-token',
  // Main stores pasted keys in the OS keychain and hands them to the sidecar at runtime, outside
  // settings/.env/providers_json. Empty clears the key and restores the session credential.
  MINDSHUB_SET_USER_KEY: 'mindshub:set-user-key',
  // Organization reads and switches live beside the credential in main; renderer origins lack
  // Keycloak CORS access. The active-organization claim determines whose credits a turn spends.
  MINDSHUB_LIST_ORGS: 'mindshub:list-orgs',
  MINDSHUB_SWITCH_ORG: 'mindshub:switch-org',
  // Broadcast all token-store changes, including silent refresh and session death; the initiating
  // login promise may be lost on reload.
  MINDSHUB_AUTH_CHANGED: 'mindshub:auth-changed',

  // App
  APP_READY: 'app:ready',
  APP_GET_PLATFORM: 'app:get-platform',
  APP_UI_VERSION: 'app:ui-version',
  OPEN_EXTERNAL: 'app:open-external',
  SHOW_ITEM_IN_FOLDER: 'shell:show-item-in-folder',
  // Electron 39 disables MacWebContentsOcclusion, so macOS document.visibilityState misses
  // hidden/minimized windows. Polling gates also need this host signal.
  APP_WINDOW_VISIBILITY: 'app:window-visibility',

  // First-class Code workspace (independent from the parked Coding Mode MVP).
  CODE_PICK_FOLDER: 'code:pick-folder',

  // Run the local claude CLI in an embedded PTY for claude-code-harness tasks.
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
