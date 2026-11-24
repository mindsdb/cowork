import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const hostMock = vi.hoisted(() => ({ host: { openExternal: vi.fn() } }));
vi.mock('../../../../platform/host', () => hostMock);
vi.mock('../../../hooks/useAccountUser', () => ({ useAccountUser: () => ({ orgId: 'org-1', sub: 'u1' }) }));

import { TrackingRefusal, CREDITS_REQUIRED_CODE } from './TrackingRefusal';
import { HubUsageContext } from '../../../lib/hubUsageContext';
import { MINDS_ADD_FUNDS_URL, consoleUrlFor } from '../../../../lib/mindsUrls';

describe('TrackingRefusal', () => {
  it("sends a billing owner to add credits for this session's organization (ENG-4333)", () => {
    render(
      <HubUsageContext.Provider value={{ usage: { isBillingOwner: true } }}>
        <TrackingRefusal error={{ code: CREDITS_REQUIRED_CODE }} />
      </HubUsageContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(hostMock.host.openExternal).toHaveBeenCalledWith(
      consoleUrlFor(MINDS_ADD_FUNDS_URL, { organizationId: 'org-1', subject: 'u1' }),
    );
  });
});
