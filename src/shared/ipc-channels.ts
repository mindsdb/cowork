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

  // Server
  SERVER_RESTART: 'server:restart',
  SERVER_UPDATE_STATUS: 'server:update-status',

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
  MINDSHUB_REFRESH: 'mindshub:refresh',
  MINDSHUB_FINALIZE: 'mindshub:finalize',
  MINDSHUB_GET_CACHED_TOKEN: 'mindshub:get-cached-token',
  // Pushed main → renderer whenever the MindsHub token store changes
  // (login, silent refresh, logout, definitive session death). The
  // renderer's signed-in indicator subscribes to this instead of
  // depending solely on the promise of the sign-in call that happened
  // to initiate the flow (ENG-761: that promise can be lost — reload,
  // hung exchange — leaving the UI stuck on "Sign in" forever).
  MINDSHUB_AUTH_CHANGED: 'mindshub:auth-changed',

  // Browser Control bridge (M1, read-only) — Electron main owns the CDP
  // connection to the user's own Chrome. Renderer reaches these only through
  // src/renderer/platform/host.ts (purity gate). BROWSER_STATE is a push
  // event (webContents.send), the rest are invoke request/response.
  BROWSER_ATTACH: 'browser:attach',
  BROWSER_APPROVE: 'browser:approve',
  BROWSER_DETACH: 'browser:detach',
  BROWSER_CANCEL_ATTACH: 'browser:cancelAttach',
  BROWSER_LIST_TABS: 'browser:listTabs',
  BROWSER_STATUS: 'browser:status',
  BROWSER_REVOKE: 'browser:revoke',
  BROWSER_TAKE_OVER: 'browser:takeOver',
  // Renderer keeps main in sync with the ACTIVE conversation id (on change and
  // at tab-approval time) so the command poller can identify itself to
  // cowork-server (bridge/hello requires a conversation_id or session_id; the
  // session is conversation-scoped).
  BROWSER_SET_CONVERSATION: 'browser:setConversation',
  // Renderer signals a user Stop LOCALLY (in addition to the server control
  // gate) so the poller's pre-execution check can gate a command that was
  // handed out just before the Stop landed. Cleared on the next attach.
  BROWSER_STOP: 'browser:stop',
  BROWSER_INSPECT: 'browser:inspect',
  BROWSER_NAVIGATE: 'browser:navigate',
  BROWSER_SCROLL: 'browser:scroll',
  BROWSER_WAIT: 'browser:wait',
  BROWSER_STATE: 'browser:state',

  // Instrumentation — stable, anonymous per-device id for content-free
  // product analytics (Browser Control funnel, WS5). Read-only from renderer.
  INSTALLATION_GET: 'installation:get',

  // App
  APP_READY: 'app:ready',
  APP_GET_PLATFORM: 'app:get-platform',
  APP_UI_VERSION: 'app:ui-version',
  OPEN_EXTERNAL: 'app:open-external',
  SHOW_ITEM_IN_FOLDER: 'shell:show-item-in-folder',
} as const;
