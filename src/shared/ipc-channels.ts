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

  // MindsHub — split from oauth:connect so env writes only happen
  // after the user has chosen an LLM path (free users may never
  // commit Minds as the LLM if they go BYOK).
  MINDSHUB_LOGIN: 'mindshub:login',
  MINDSHUB_REFRESH: 'mindshub:refresh',
  MINDSHUB_FINALIZE: 'mindshub:finalize',
  MINDSHUB_GET_CACHED_TOKEN: 'mindshub:get-cached-token',

  // App
  APP_READY: 'app:ready',
  APP_GET_PLATFORM: 'app:get-platform',
  APP_UI_VERSION: 'app:ui-version',
  OPEN_EXTERNAL: 'app:open-external',
  SHOW_ITEM_IN_FOLDER: 'shell:show-item-in-folder',
} as const;
