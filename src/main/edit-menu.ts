import { MenuItem, type Menu } from 'electron';

/** The id app.ts gives the app menu's Edit menu, so the Redo below can find it. */
export const EDIT_MENU_ID = 'edit';

/**
 * On macOS, Cmd+Y redoes as well as Shift+Cmd+Z (ENG-3793).
 *
 * Cmd+Y is redo in Office and Google Docs on the Mac, and Ctrl+Y is redo
 * elsewhere. Windows and Linux already have it: Electron's Redo takes Ctrl+Y on
 * Windows, and Chromium's text fields take it as redo everywhere but macOS. On
 * macOS nothing bound Cmd+Y, so it did nothing in any text field in the app.
 *
 * A menu item has one accelerator, so this is a second Redo, hidden: the Edit
 * menu looks as it always has, and a hidden item's accelerator still works on
 * macOS. Like the menu's own Redo, it redoes in whatever has the focus.
 */
export function addRedoOnCmdY(menu: Menu, platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'darwin') return;
  menu.getMenuItemById(EDIT_MENU_ID)?.submenu?.append(
    new MenuItem({ role: 'redo', accelerator: 'Command+Y', visible: false }),
  );
}
