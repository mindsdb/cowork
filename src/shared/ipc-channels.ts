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

  // OAuth — pure PKCE bridge (no MindsHub-specific side effects)
  OAUTH_CANCEL: 'oauth:cancel',

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
