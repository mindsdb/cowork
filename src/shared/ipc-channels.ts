export const IPC = {
  // Installer
  INSTALL_CHECK: 'install:check',
  INSTALL_START: 'install:start',
  INSTALL_LOG: 'install:log',
  INSTALL_PROGRESS: 'install:progress',
  INSTALL_DONE: 'install:done',
  INSTALL_ERROR: 'install:error',

  // Anton process
  ANTON_START: 'anton:start',
  ANTON_DATA: 'anton:data',
  ANTON_INPUT: 'anton:input',
  ANTON_RESIZE: 'anton:resize',
  ANTON_EXIT: 'anton:exit',
  ANTON_IS_RUNNING: 'anton:is-running',
  ANTON_KILL: 'anton:kill',

  // Settings / Onboarding
  SETTINGS_SAVE: 'settings:save',
  SETTINGS_CHECK_CONFIGURED: 'settings:check-configured',
  SETTINGS_VALIDATE: 'settings:validate',

  // Projects
  PROJECTS_LIST: 'projects:list',
  PROJECTS_CREATE: 'projects:create',
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

  // Clipboard
  CLIPBOARD_SAVE_IMAGE: 'clipboard:save-image',

  // App
  APP_READY: 'app:ready',
  APP_GET_PLATFORM: 'app:get-platform',
} as const;
