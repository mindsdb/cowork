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

  // Anton process
  ANTON_START: 'anton:start',
  ANTON_DATA: 'anton:data',
  ANTON_INPUT: 'anton:input',
  ANTON_RESIZE: 'anton:resize',
  ANTON_EXIT: 'anton:exit',
  ANTON_IS_RUNNING: 'anton:is-running',
  ANTON_KILL: 'anton:kill',
  EXPLAINABILITY_LATEST: 'explainability:latest',

  // Settings / Onboarding
  SETTINGS_READ: 'settings:read',
  SETTINGS_SAVE: 'settings:save',
  SETTINGS_CHECK_CONFIGURED: 'settings:check-configured',
  SETTINGS_VALIDATE: 'settings:validate',
  TERMS_ACCEPT: 'terms:accept',

  // Projects
  PROJECTS_LIST: 'projects:list',
  PROJECTS_CREATE: 'projects:create',
  PROJECTS_RENAME: 'projects:rename',
  PROJECTS_DELETE: 'projects:delete',
  PROJECTS_GET_ACTIVE: 'projects:get-active',
  PROJECTS_SET_ACTIVE: 'projects:set-active',

  // Minds
  MINDS_STATUS: 'minds:status',
  MINDS_LIST: 'minds:list',
  MINDS_GET: 'minds:get',
  MINDS_LIST_DATASOURCES: 'minds:list-datasources',
  MINDS_CONNECT: 'minds:connect',
  MINDS_DISCONNECT: 'minds:disconnect',
  MINDS_STATUS_CHANGED: 'minds:status-changed',

  // Data Vault
  VAULT_LIST: 'vault:list',
  VAULT_LOAD: 'vault:load',
  VAULT_SAVE: 'vault:save',
  VAULT_DELETE: 'vault:delete',
  VAULT_CHANGED: 'vault:changed',

  // Clipboard
  CLIPBOARD_SAVE_IMAGE: 'clipboard:save-image',

  // App
  APP_READY: 'app:ready',
  APP_GET_PLATFORM: 'app:get-platform',
  APP_UI_VERSION: 'app:ui-version',
  OPEN_EXTERNAL: 'app:open-external',
  SHOW_ITEM_IN_FOLDER: 'shell:show-item-in-folder',
} as const;
