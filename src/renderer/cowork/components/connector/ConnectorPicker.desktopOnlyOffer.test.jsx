// A connector cloud doesn't run yet hands the dialog what the picker already
// knows: the member's own custom one for it, and whether one can be built.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { setOrgMode } from '../../../lib/orgMode';

const fetchConnectors = vi.fn();
const fetchCanBuildCustomConnector = vi.fn();
vi.mock('../../api', () => ({
  fetchConnectors: (...args) => fetchConnectors(...args),
  fetchCanBuildCustomConnector: (...args) => fetchCanBuildCustomConnector(...args),
}));
vi.mock('../../../platform/host', () => ({
  host: { openExternal: vi.fn() },
}));

import ConnectorPicker from './ConnectorPicker';

const DESKTOP_ONLY_TITLE = 'Connectors available in Cowork Desktop App';
const HASDATA = { id: 'hasdata', label: 'HasData', category: 'web', cloud_available: false };
const HASDATA_CUSTOM = { id: 'hasdata_custom', label: 'HasData', category: 'web', custom: true };
const GMAIL = { id: 'gmail', label: 'Gmail', category: 'communication' };

function section(title) {
  return screen.getByText(title, { exact: false }).closest('div').parentElement;
}

async function pickDesktopOnly(connectors, { canBuild }) {
  setOrgMode(true);
  fetchConnectors.mockResolvedValue(connectors);
  fetchCanBuildCustomConnector.mockResolvedValue(canBuild);
  const onDesktopOnly = vi.fn();
  render(
    <ConnectorPicker open onPick={vi.fn()} onDesktopOnly={onDesktopOnly}
      onBuildCustom={vi.fn()} onClose={vi.fn()} />,
  );
  await screen.findByText(DESKTOP_ONLY_TITLE, { exact: false });
  if (canBuild) await screen.findAllByText('Build a custom connector');
  fireEvent.click(within(section(DESKTOP_ONLY_TITLE)).getByText('HasData'));
  return onDesktopOnly;
}

afterEach(() => {
  setOrgMode(false);
  fetchConnectors.mockReset();
  fetchCanBuildCustomConnector.mockReset();
});

describe('picking a connector cloud does not run yet', () => {
  it("passes the member's own custom template for it", async () => {
    const onDesktopOnly = await pickDesktopOnly([GMAIL, HASDATA, HASDATA_CUSTOM], { canBuild: true });

    expect(onDesktopOnly).toHaveBeenCalledWith(HASDATA, { customMatch: HASDATA_CUSTOM, canBuild: true });
  });

  it('passes no match and the build answer when there is no custom one', async () => {
    const onDesktopOnly = await pickDesktopOnly([GMAIL, HASDATA], { canBuild: false });

    expect(onDesktopOnly).toHaveBeenCalledWith(HASDATA, { customMatch: null, canBuild: false });
  });
});
