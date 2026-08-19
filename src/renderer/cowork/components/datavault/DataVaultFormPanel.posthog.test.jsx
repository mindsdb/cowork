// Regression coverage for the PostHog project-discovery flow
// (ENG-1602). Nothing in DataVaultFormPanel.test.jsx built a spec
// with `_connector_id: 'posthog'`, so a guard bug that only manifests
// on that path — re-running discovery instead of submitting once a
// project is picked — shipped with a green CI. See PR #657 review.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataVaultFormPanel } from './DataVaultFormPanel';
import { clearForm, setForm } from './formStore';
import { discoverPostHogProjects } from '../../api';

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, discoverPostHogProjects: vi.fn() };
});

const CID = 'conv-datavault-posthog';

const POSTHOG_SPEC = {
  form_id: 'posthog-f1',
  _connector_id: 'posthog',
  title: 'Connect PostHog',
  methods: [
    {
      id: 'personal-api-key',
      label: 'Personal API key',
      fields: [
        {
          name: 'personal_api_key', label: 'Personal API key', type: 'password', required: true,
          placeholder: 'phx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        },
        {
          name: 'host', label: 'Host', type: 'select', required: true,
          default: 'https://us.posthog.com',
          options: [{ value: 'https://us.posthog.com', label: 'US Cloud' }],
        },
        { name: 'custom_host', label: 'Self-hosted URL', type: 'url', required: false },
        { name: 'project_id', label: 'Project ID', type: 'text', required: true, placeholder: '12345' },
      ],
    },
  ],
};

describe('DataVaultFormPanel — PostHog project discovery', () => {
  beforeEach(() => {
    clearForm(CID);
    discoverPostHogProjects.mockReset();
  });

  it('submits once a discovered project is picked instead of re-running discovery', async () => {
    discoverPostHogProjects.mockResolvedValue({ projects: [{ id: 123, name: 'Prod' }] });
    setForm(CID, POSTHOG_SPEC);
    const onSubmit = vi.fn();
    render(<DataVaultFormPanel conversationId={CID} onSubmit={onSubmit} />);

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/phx_/), 'phx_test');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    await screen.findByRole('combobox', { name: /posthog project/i });
    expect(discoverPostHogProjects).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('combobox', { name: /posthog project/i }));
    await user.click(screen.getByRole('option', { name: 'Prod' }));

    await user.click(screen.getByRole('button', { name: /submit/i }));

    expect(discoverPostHogProjects).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ values: expect.objectContaining({ project_id: '123' }) })
    );
  });

  it('keeps the manual Project ID field visible and usable after discovery runs', async () => {
    discoverPostHogProjects.mockResolvedValue({ projects: [{ id: 123, name: 'Prod' }] });
    setForm(CID, POSTHOG_SPEC);
    const onSubmit = vi.fn();
    render(<DataVaultFormPanel conversationId={CID} onSubmit={onSubmit} />);

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/phx_/), 'phx_test');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await screen.findByRole('combobox', { name: /posthog project/i });

    // Manual entry, ignoring the discovered select entirely.
    await user.type(screen.getByPlaceholderText('12345'), '999');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    expect(discoverPostHogProjects).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ values: expect.objectContaining({ project_id: '999' }) })
    );
  });

  it('submits the typed Project ID when the user types over a picked project', async () => {
    discoverPostHogProjects.mockResolvedValue({ projects: [{ id: 123, name: 'Prod' }] });
    setForm(CID, POSTHOG_SPEC);
    const onSubmit = vi.fn();
    render(<DataVaultFormPanel conversationId={CID} onSubmit={onSubmit} />);

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/phx_/), 'phx_test');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await screen.findByRole('combobox', { name: /posthog project/i });

    // Pick one, then correct it by hand. The box the user can still see wins.
    await user.click(screen.getByRole('combobox', { name: /posthog project/i }));
    await user.click(screen.getByRole('option', { name: 'Prod' }));
    await user.type(screen.getByPlaceholderText('12345'), '999');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ values: expect.objectContaining({ project_id: '999' }) })
    );
    // UI-only field, never sent to the connector engine.
    expect(onSubmit.mock.calls[0][0].values).not.toHaveProperty('posthog_project_choice');
  });

  it('marks the choice field and sends nothing when submitted with no project at all', async () => {
    discoverPostHogProjects.mockResolvedValue({ projects: [{ id: 123, name: 'Prod' }] });
    setForm(CID, POSTHOG_SPEC);
    const onSubmit = vi.fn();
    render(<DataVaultFormPanel conversationId={CID} onSubmit={onSubmit} />);

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/phx_/), 'phx_test');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await screen.findByRole('combobox', { name: /posthog project/i });

    // Neither picked nor typed. Without the required check this re-runs
    // discovery and shows the user nothing at all.
    await user.click(screen.getByRole('button', { name: /submit/i }));

    expect(await screen.findByText('PostHog project is required.')).toBeInTheDocument();
    expect(discoverPostHogProjects).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
