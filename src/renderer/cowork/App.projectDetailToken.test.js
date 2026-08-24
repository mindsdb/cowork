// Guards the project-detail resolution token (ENG-1233). The token is what
// keeps a slow `/projects/:id` fetch from applying its result after the user has
// already navigated somewhere else — the class of stale-response race that a
// raw useRef counter only half-covered (it superseded a newer detail id, but
// not a Back to the grid).
import { describe, it, expect } from 'vitest';
import { makeProjectDetailToken } from './App';

// A resolution applies its result iff the token it captured at request time is
// still current. This mirrors the isCurrent() guard in enterProjectDetail.
function resolves(token, capturedReqId) {
  return token.isCurrent(capturedReqId);
}

describe('makeProjectDetailToken', () => {
  it('applies a resolution that nothing superseded', () => {
    const token = makeProjectDetailToken();
    const reqId = token.begin(); // enterProjectDetail('A')
    expect(resolves(token, reqId)).toBe(true);
  });

  it('supersedes a slow /projects/:A when /projects/:B starts first', () => {
    const token = makeProjectDetailToken();
    const reqA = token.begin(); // enterProjectDetail('A') — slow
    const reqB = token.begin(); // enterProjectDetail('B') — faster
    expect(resolves(token, reqB)).toBe(true); // B applies
    expect(resolves(token, reqA)).toBe(false); // late A cannot overwrite B
  });

  it('supersedes a slow detail fetch after Back to the grid (the Major race)', () => {
    const token = makeProjectDetailToken();
    // /projects/A is still loading...
    const reqA = token.begin();
    // ...when the user presses Back to /projects; enterRoute('projects') leaves.
    token.leave();
    // The late A response must NOT pass the guard — otherwise it would select A
    // and the URL bridge would push /projects/A again.
    expect(resolves(token, reqA)).toBe(false);
  });

  it('supersedes a slow detail fetch after navigating Home', () => {
    const token = makeProjectDetailToken();
    const reqA = token.begin();
    token.leave(); // enterHome()
    expect(resolves(token, reqA)).toBe(false);
  });

  it('lets a detail opened after leaving still resolve', () => {
    const token = makeProjectDetailToken();
    token.begin();
    token.leave(); // left detail
    const reqNext = token.begin(); // enterProjectDetail('C') afterwards
    expect(resolves(token, reqNext)).toBe(true);
  });
});
