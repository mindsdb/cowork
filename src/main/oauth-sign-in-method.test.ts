import { describe, expect, it } from 'vitest';
import { pickSignInMethod } from './oauth-sign-in-method';

const rest = { id: 'browser_oauth_builtin', hidden: false, oauth: { scopes: ['search:read'] } };
const mcp = { id: 'mcp', hidden: true, oauth: { scopes: ['search:read.public'] } };
const botToken = { id: 'bot-token', hidden: false };

describe('pickSignInMethod', () => {
  it('takes the sign-in the server shows for a new connection', () => {
    expect(pickSignInMethod([{ ...mcp }, botToken, rest])?.id).toBe('browser_oauth_builtin');
    expect(pickSignInMethod([{ ...mcp, hidden: false }, { ...rest, hidden: true }])?.id).toBe('mcp');
  });

  it('takes the method a reconnect names, even when it is hidden', () => {
    expect(pickSignInMethod([rest, mcp], 'mcp')?.id).toBe('mcp');
  });

  it('never picks a method that is not a built-in sign-in', () => {
    expect(pickSignInMethod([botToken], 'bot-token')).toBeUndefined();
    expect(pickSignInMethod(undefined)).toBeUndefined();
  });

  it('falls back to the first sign-in when every one is hidden', () => {
    expect(pickSignInMethod([{ ...rest, hidden: true }, mcp])?.id).toBe('browser_oauth_builtin');
  });
});
