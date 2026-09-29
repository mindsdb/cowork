// Code Mode's task rows share the sidebar with the chat rail's nav rows, so a
// hovered row should look the same in either mode. happy-dom does no styling,
// so lock the source invariant: both hover rules declare the same fill.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Strip comments so a prose mention of a property can't satisfy a match.
function readCss(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

function hoverBackground(css: string, selector: string): string | null {
  const at = css.indexOf(`${selector} {`);
  if (at === -1) return null;
  const body = css.slice(at, css.indexOf('}', at));
  return body.match(/background:\s*([^;]+);/)?.[1].trim() ?? null;
}

describe('sidebar row hover', () => {
  it('Code Mode task rows use the chat rail hover fill', () => {
    const chat = hoverBackground(readCss('src/renderer/cowork/styles/globals.css'), '.app-sidebar .recent-item:hover');
    const code = hoverBackground(readCss('src/renderer/cowork/code/code.css'), '.code-sidebar-session-row:hover');
    expect(chat, 'chat rail hover rule not found').not.toBeNull();
    expect(code).toBe(chat);
  });
});
