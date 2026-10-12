// The upload service refuses a report owned by another account with HTTP 409
// `artifact_owned_by_other_user`; cowork-server forwards the code and both
// request helpers put it on the thrown error as `code`. Every Share surface
// shows one fixed sentence for it.
import { describe, it, expect } from 'vitest';
import {
  OWNED_BY_OTHER_USER_CODE,
  OWNED_BY_OTHER_USER_MESSAGE,
  isOwnedByOtherUserError,
} from './publishErrors';

function httpError(status, code, message = 'x') {
  return Object.assign(new Error(message), { status, code });
}

describe('isOwnedByOtherUserError', () => {
  it('pins the wire code and the user-facing sentence', () => {
    expect(OWNED_BY_OTHER_USER_CODE).toBe('artifact_owned_by_other_user');
    expect(OWNED_BY_OTHER_USER_MESSAGE).toBe('This artifact was published by another owner.');
  });

  it('recognises the code on a request error', () => {
    expect(isOwnedByOtherUserError(httpError(409, OWNED_BY_OTHER_USER_CODE))).toBe(true);
  });

  it('ignores a bare 409, other codes and plain errors', () => {
    expect(isOwnedByOtherUserError(httpError(409, null, 'Conflict'))).toBe(false);
    expect(isOwnedByOtherUserError(httpError(403, 'permission_denied'))).toBe(false);
    expect(isOwnedByOtherUserError(new Error('boom'))).toBe(false);
    expect(isOwnedByOtherUserError(undefined)).toBe(false);
  });
});
