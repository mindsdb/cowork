import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  MenuItem: class {
    constructor(options: Record<string, unknown>) { Object.assign(this, options); }
  },
}));

import type { Menu } from 'electron';
import { addRedoOnCmdY, EDIT_MENU_ID } from './edit-menu';

// The part of a built menu addRedoOnCmdY reaches: the Edit menu, by its id.
function appMenu() {
  const edit: unknown[] = [];
  const menu = {
    getMenuItemById: (id: string) => (id === EDIT_MENU_ID ? { submenu: { append: (item: unknown) => edit.push(item) } } : null),
  } as unknown as Menu;
  return { menu, edit };
}

describe('addRedoOnCmdY', () => {
  it('gives the Edit menu a hidden Redo on Cmd+Y on macOS', () => {
    const { menu, edit } = appMenu();
    addRedoOnCmdY(menu, 'darwin');
    expect(edit).toEqual([expect.objectContaining({ role: 'redo', accelerator: 'Command+Y', visible: false })]);
  });

  it.each(['win32', 'linux'] as const)('adds nothing on %s, where Ctrl+Y redoes already', (platform) => {
    const { menu, edit } = appMenu();
    addRedoOnCmdY(menu, platform);
    expect(edit).toEqual([]);
  });

  it('leaves a menu with no Edit menu alone', () => {
    const menu = { getMenuItemById: () => null } as unknown as Menu;
    expect(() => addRedoOnCmdY(menu, 'darwin')).not.toThrow();
  });
});

describe('the app menu in app.ts', () => {
  // Read from source rather than run: app.ts registers the whole app at import.
  const source = readFileSync(resolve(__dirname, 'app.ts'), 'utf-8');

  it('names its Edit menu, and adds the Redo before the menu is set', () => {
    expect(source).toContain("{ role: 'editMenu', id: EDIT_MENU_ID }");
    const added = source.indexOf('addRedoOnCmdY(appMenu);');
    expect(added).toBeGreaterThan(source.indexOf('const appMenu = Menu.buildFromTemplate(template);'));
    expect(source.indexOf('Menu.setApplicationMenu(appMenu);')).toBeGreaterThan(added);
  });
});
