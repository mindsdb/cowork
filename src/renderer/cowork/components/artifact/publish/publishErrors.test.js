// The upload service refuses a report owned by another account with HTTP 409
// `artifact_owned_by_other_user`; cowork-server forwards the code and both
// request helpers put it on the thrown error as `code`. Every Share surface
// shows one fixed sentence for it.
import { describe, it, expect } from 'vitest';
import {
  OWNED_BY_OTHER_USER_CODE,
  OWNED_BY_OTHER_USER_MESSAGE,
  isOwnedByOtherUserError,
  isShareOrgRequiredError,
  isDatasourceApprovalError,
  pendingDatasourcesFromError,
  publishRefusalMessage,
  unapprovedDatasourcesNotice,
} from './publishErrors';
import { PUBLISH_SHELL_TOO_OLD_CODE, SHARE_ORG_REQUIRED_CODE } from '../../../lib/sharingContract';

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

/* cowork-server answers a share with everyone that the caller may not make
   with 403 {"detail": "<reason>", "code": "share_org_required"}
   (cowork.services.publish.ShareOrgRequired.refusal); both request helpers
   put the reason on the thrown error as its message. */
describe('a refused share with everyone', () => {
  const REASON = 'Sharing an artifact with everyone in the organization needs the artifacts.share_org permission.';

  it("pins the wire code under cowork-server's name", () => {
    expect(SHARE_ORG_REQUIRED_CODE).toBe('share_org_required');
  });

  it('is recognized by its code alone', () => {
    expect(isShareOrgRequiredError(httpError(403, SHARE_ORG_REQUIRED_CODE, REASON))).toBe(true);
    expect(isShareOrgRequiredError(httpError(403, 'permission_denied', REASON))).toBe(false);
    expect(isShareOrgRequiredError(httpError(403, null, REASON))).toBe(false);
  });

  it('shows the reason as it is, once', () => {
    expect(publishRefusalMessage(httpError(403, SHARE_ORG_REQUIRED_CODE, REASON))).toBe(REASON);
    expect(publishRefusalMessage(httpError(409, OWNED_BY_OTHER_USER_CODE))).toBe(OWNED_BY_OTHER_USER_MESSAGE);
    expect(publishRefusalMessage(httpError(502, null, 'Publishing failed: upload timed out'))).toBeNull();
  });
});

describe('connection approval refusals', () => {
  const approval = Object.assign(new Error('m'), {
    code: 'datasource_approval_required',
    body: { detail: { pending: [{ engine: 'pg', name: 'a', label: 'pg/a' }] } },
  });

  it('reads the pending list from a 409', () => {
    expect(isDatasourceApprovalError(approval)).toBe(true);
    expect(pendingDatasourcesFromError(approval)).toEqual([{ engine: 'pg', name: 'a', label: 'pg/a' }]);
    expect(pendingDatasourcesFromError(new Error('x'))).toEqual([]);
  });

  it('words both refusals', () => {
    expect(publishRefusalMessage(approval)).toMatch(/haven't approved/);
    expect(publishRefusalMessage(Object.assign(new Error('x'), { code: PUBLISH_SHELL_TOO_OLD_CODE }))).toMatch(/Update the app/);
  });

  it('names connections published without credentials', () => {
    expect(unapprovedDatasourcesNotice({ unapprovedDatasources: [{ label: 'mysql/late' }] })).toMatch(/mysql\/late/);
    expect(unapprovedDatasourcesNotice({})).toBe('');
  });
});
