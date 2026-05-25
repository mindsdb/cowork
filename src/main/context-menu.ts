import { BrowserWindow, Menu } from 'electron';

/**
 * Builds the native context menu item list for a given right-click target.
 *
 * Three cases:
 *   1. Editable field  → Undo/Redo · Cut/Copy/Paste · Delete · Select All
 *                        (spell-check suggestions prepended when present)
 *   2. Read-only text selection → Copy · Select All
 *   3. Empty space     → [] (caller suppresses the menu entirely)
 */
function buildContextMenuTemplate(
  webContents: Electron.WebContents,
  params: Electron.ContextMenuParams,
): Electron.MenuItemConstructorOptions[] {
  if (params.isEditable) {
    const template: Electron.MenuItemConstructorOptions[] = [];

    if (params.misspelledWord && params.dictionarySuggestions.length > 0) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
        template.push({
          label: suggestion,
          // Guard against the window being closed between menu display and
          // the user clicking a suggestion (async gap).
          click: () => { if (!webContents.isDestroyed()) webContents.replaceMisspelling(suggestion); },
        });
      }
      template.push({ type: 'separator' });
    }

    template.push(
      { role: 'undo',   enabled: params.editFlags.canUndo },
      { role: 'redo',   enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut',    enabled: params.editFlags.canCut },
      { role: 'copy',   enabled: params.editFlags.canCopy },
      { role: 'paste',  enabled: params.editFlags.canPaste },
    );

    if (process.platform === 'darwin') {
      template.push({ role: 'pasteAndMatchStyle', enabled: params.editFlags.canPaste });
    }

    template.push(
      { role: 'delete',    enabled: params.editFlags.canDelete },
      { type: 'separator' },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll },
    );

    return template;
  }

  // Read-only text selection — only Copy + Select All make sense.
  if (!params.selectionText.trim()) {
    return [];
  }

  return [
    { role: 'copy',      enabled: params.editFlags.canCopy },
    { type: 'separator' },
    { role: 'selectAll', enabled: params.editFlags.canSelectAll },
  ];
}

/**
 * Attaches a native OS context menu to the given BrowserWindow.
 * Call once per window instance after the BrowserWindow is constructed.
 */
export function installNativeContextMenus(window: BrowserWindow): void {
  window.webContents.on('context-menu', (event, params) => {
    const template = buildContextMenuTemplate(window.webContents, params);
    if (template.length === 0) return;

    event.preventDefault();
    Menu.buildFromTemplate(template).popup({
      window,
      frame: params.frame ?? undefined,
      x: params.x,
      y: params.y,
      sourceType: process.platform === 'darwin' ? undefined : params.menuSourceType,
    });
  });
}
