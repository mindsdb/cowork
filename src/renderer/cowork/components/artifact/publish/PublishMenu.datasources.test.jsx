import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PublishMenu } from './PublishMenu';
import { DatasourceApprovalNotice } from './DatasourceApprovalNotice';

const PENDING = [{ engine: 'postgres', name: 'scm', label: 'Sales DB (postgres/scm)' }];

function makeController(overrides = {}) {
  return {
    publishedUrl: '',
    phase: 'idle',
    busy: false,
    error: '',
    accessMode: 'public',
    accessPassword: '',
    accessEmails: [],
    orgAllowed: false,
    ownerOnly: false,
    accessLoaded: true,
    versions: [],
    modified: false,
    setError: vi.fn(),
    loadVersions: vi.fn(),
    publish: vi.fn(async () => true),
    unpublish: vi.fn(),
    activate: vi.fn(),
    update: vi.fn(async () => true),
    ...overrides,
  };
}

describe('the connection approval block', () => {
  it('lists the connections whose credentials publishing uploads', () => {
    render(<DatasourceApprovalNotice pending={PENDING} />);
    expect(screen.getByText(/Sales DB \(postgres\/scm\)/)).toBeTruthy();
  });

  it('shows nothing without pending connections', () => {
    const { container } = render(<DatasourceApprovalNotice pending={[]} />);
    expect(container.textContent).toBe('');
  });

  it('shows the list in the Share dialog and approves it on Share', async () => {
    const ctrl = makeController({ pendingDatasources: PENDING });
    render(<PublishMenu controller={ctrl} />);
    fireEvent.click(screen.getByText('Share'));
    expect(screen.getByText(/Sales DB \(postgres\/scm\)/)).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'Share' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(ctrl.publish).toHaveBeenCalledWith(
      expect.anything(), { approvedDatasources: PENDING },
    ));
  });

  it('approves the list on Update of a published app', async () => {
    const ctrl = makeController({
      publishedUrl: 'https://share/abc', accessMode: 'restricted', ownerOnly: true,
      modified: true, pendingDatasources: PENDING,
    });
    render(<PublishMenu controller={ctrl} />);
    // An owner-only share reads "Share" on the trigger.
    fireEvent.click(screen.getByText('Share'));
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(ctrl.update).toHaveBeenCalledWith({ approvedDatasources: PENDING }));
  });
});
