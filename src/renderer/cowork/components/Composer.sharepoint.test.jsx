// "Add files from SharePoint" in the composer's add menu: only with a project
// to import into, and only when App offers the entry point (not in org mode).
// Mocks follow Composer.test.jsx.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Composer from './Composer';

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchSkills: vi.fn(async () => []),
    createProject: vi.fn(async (name) => ({ name })),
    writeProjectFile: vi.fn(async () => ({})),
    uploadProjectFiles: vi.fn(async () => ({})),
  };
});

// The coding-mode harness pill only renders on desktop (`!host.isWeb`) —
// jsdom's default host reads as web, which would hide it from every test
// in this file. Only the "Model Router" harness-switch test below
// exercises it; everything else (api.js's getApiOrigin() at import time,
// etc.) keeps the real host.
// Spread the real modules and override only what these tests assert on, so a
// new export never has to be added here to keep the file importable.
const hostSpies = vi.hoisted(() => ({ openExternal: vi.fn() }));
vi.mock('../../platform/host', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    host: {
      ...actual.host,
      isWeb: false,
      openExternal: hostSpies.openExternal,
      detectClaudeCode: vi.fn(async () => ({ installed: true, path: '/usr/local/bin/claude' })),
    },
  };
});

const analyticsSpies = vi.hoisted(() => ({ trackBillingOpened: vi.fn() }));
vi.mock('../lib/analytics', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, trackBillingOpened: analyticsSpies.trackBillingOpened };
});

const renderComposer = (overrides = {}) => {
  const props = {
    onSend: vi.fn(),
    project: { name: 'general' },
    projects: [{ name: 'general' }],
    onProjectChange: vi.fn(),
    onCreateProject: vi.fn(async ({ name }) => ({ name })),
    models: [],
    ...overrides,
  };
  render(<Composer {...props} />);
  return props;
};

describe('Composer — Add files from SharePoint', () => {
  it('starts a SharePoint import for the selected project', async () => {
    const user = userEvent.setup();
    const onAddSharePointFiles = vi.fn();
    renderComposer({ onAddSharePointFiles });

    await user.click(screen.getByRole('button', { name: 'Add context' }));
    await user.click(screen.getByRole('button', { name: /Add files from SharePoint/ }));

    expect(onAddSharePointFiles).toHaveBeenCalledWith('general');
  });

  it('has no SharePoint item without a project', async () => {
    const user = userEvent.setup();
    renderComposer({ onAddSharePointFiles: vi.fn(), project: null });

    await user.click(screen.getByRole('button', { name: 'Add context' }));

    expect(screen.getByRole('button', { name: /Attach files or photos/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add files from SharePoint/ })).toBeNull();
  });

  it('has no SharePoint item when App offers none (org mode)', async () => {
    const user = userEvent.setup();
    renderComposer();

    await user.click(screen.getByRole('button', { name: 'Add context' }));

    expect(screen.queryByRole('button', { name: /Add files from SharePoint/ })).toBeNull();
  });
});
