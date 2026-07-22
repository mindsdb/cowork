import { describe, expect, it, vi } from 'vitest';
import { parseModifiers, resolveKey, trustedClick, trustedInsertText, trustedKey } from './browser-input';

describe('resolveKey', () => {
  it('resolves named keys case-insensitively', () => {
    expect(resolveKey('enter')).toMatchObject({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    expect(resolveKey('Enter')).toMatchObject({ key: 'Enter' });
    expect(resolveKey('ArrowLeft')).toMatchObject({ key: 'ArrowLeft', windowsVirtualKeyCode: 37 });
    expect(resolveKey('arrowdown')).toMatchObject({ key: 'ArrowDown', windowsVirtualKeyCode: 40 });
    expect(resolveKey('tab')).toMatchObject({ key: 'Tab', windowsVirtualKeyCode: 9 });
    expect(resolveKey('escape')).toMatchObject({ key: 'Escape', windowsVirtualKeyCode: 27 });
    expect(resolveKey('space')).toMatchObject({ key: ' ', code: 'Space' });
  });

  it('resolves single characters', () => {
    expect(resolveKey('a')).toMatchObject({ key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    expect(resolveKey('Z')).toMatchObject({ key: 'Z', code: 'KeyZ', windowsVirtualKeyCode: 90 });
    expect(resolveKey('7')).toMatchObject({ key: '7', code: 'Digit7', windowsVirtualKeyCode: 55 });
  });

  it('rejects non-keys', () => {
    expect(resolveKey('')).toBeNull();
    expect(resolveKey('notakey')).toBeNull();
    expect(resolveKey('arrow')).toBeNull();
  });
});

describe('parseModifiers', () => {
  it('maps names to the CDP bitmask', () => {
    expect(parseModifiers(['cmd'])).toBe(4);
    expect(parseModifiers(['ctrl'])).toBe(2);
    expect(parseModifiers(['alt'])).toBe(1);
    expect(parseModifiers(['shift'])).toBe(8);
    expect(parseModifiers(['cmd', 'shift'])).toBe(12);
    expect(parseModifiers(['control', 'command', 'meta'])).toBe(6); // aliases dedupe into bits
  });

  it('ignores junk and empty input', () => {
    expect(parseModifiers([])).toBe(0);
    expect(parseModifiers(undefined)).toBe(0);
    expect(parseModifiers(['hyper'])).toBe(0);
  });
});

function fakeWc() {
  const commands: { method: string; params: Record<string, unknown> }[] = [];
  const wc = {
    debugger: {
      isAttached: vi.fn(() => true),
      attach: vi.fn(),
      sendCommand: vi.fn(async (method: string, params: Record<string, unknown>) => {
        commands.push({ method, params });
        return undefined;
      }),
    },
  };
  return { wc, commands };
}

type FakeWc = ReturnType<typeof fakeWc>['wc'];
const asWc = (wc: FakeWc) => wc as unknown as Parameters<typeof trustedClick>[0];

describe('trusted input transport', () => {
  it('trustedClick dispatches press+release at the rounded coordinates', async () => {
    const { wc, commands } = fakeWc();
    await trustedClick(asWc(wc), 100.4, 50.6);
    expect(commands.map((c) => `${c.method}:${c.params.type}`)).toEqual([
      'Input.dispatchMouseEvent:mousePressed',
      'Input.dispatchMouseEvent:mouseReleased',
    ]);
    expect(commands[0].params).toMatchObject({ x: 100, y: 51, button: 'left', clickCount: 1 });
  });

  it('trustedKey uses keyDown (default actions) + keyUp with modifiers', async () => {
    const { wc, commands } = fakeWc();
    await trustedKey(asWc(wc), 'v', ['cmd']);
    expect(commands[0]).toMatchObject({
      method: 'Input.dispatchKeyEvent',
      params: { type: 'keyDown', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 4 },
    });
    expect(commands[1].params.type).toBe('keyUp');
  });

  it('trustedKey rejects unknown keys without touching the page', async () => {
    const { wc, commands } = fakeWc();
    await expect(trustedKey(asWc(wc), 'flerp')).rejects.toThrow('unknown key');
    expect(commands).toHaveLength(0);
  });

  it('trustedInsertText sends the whole string in one command', async () => {
    const { wc, commands } = fakeWc();
    await trustedInsertText(asWc(wc), 'hello sheets');
    expect(commands).toEqual([
      { method: 'Input.insertText', params: { text: 'hello sheets' } },
    ]);
  });

  it('attaches the debugger lazily', async () => {
    const { wc, commands } = fakeWc();
    wc.debugger.isAttached.mockReturnValueOnce(false);
    await trustedInsertText(asWc(wc), 'x');
    expect(wc.debugger.attach).toHaveBeenCalledOnce();
    expect(commands).toHaveLength(1);
  });
});
