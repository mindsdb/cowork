import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchMemory: vi.fn(),
  saveMemory: vi.fn(),
  deleteMemory: vi.fn(),
}));

vi.mock('../api', () => ({
  deleteDatasource: vi.fn(),
  deleteMemory: (...args) => api.deleteMemory(...args),
  fetchDatasources: vi.fn(async () => ({})),
  fetchMemory: (...args) => api.fetchMemory(...args),
  fetchPublishable: vi.fn(async () => ({})),
  findMemoryEntry: (sections, path) => (
    (sections || []).flatMap((section) => section.files || [])
      .find((entry) => entry.path === path) || null
  ),
  labelCategory: (category) => (
    String(category || '').replace(/^./, (letter) => letter.toUpperCase())
  ),
  publishArtifact: vi.fn(),
  saveDatasource: vi.fn(),
  saveMemory: (...args) => api.saveMemory(...args),
  validateDatasource: vi.fn(),
}));
vi.mock('../lib/analytics', () => ({ trackArtifactPublished: vi.fn() }));
vi.mock('../lib/clipboard', () => ({ copyText: vi.fn() }));
vi.mock('../../platform/host', () => ({ host: { isWeb: true } }));

import UtilitiesView from './UtilitiesView';
import { groupMemoryItems } from '../lib/memoryTransform';

const entry = {
  path: 'Project:project-1:rules',
  scope: 'Project',
  projectId: 'project-1',
  projectName: 'billing',
  category: 'rules',
  content: 'Original rules.',
  capabilities: { canEdit: true, canDelete: true },
};

// A second slot in the same project owned by somebody else. The sidebar lists
// both, so the editor and the selection can point at different members' rows.
const otherMemberEntry = {
  path: 'Project:project-1:lessons',
  scope: 'Project',
  projectId: 'project-1',
  projectName: 'billing',
  category: 'lessons',
  content: 'Lessons from a teammate.',
  capabilities: { canEdit: false, canDelete: false },
};

function memoryWith(...files) {
  return {
    sections: [{
      scope: 'Project',
      projectName: 'billing',
      projectId: 'project-1',
      files,
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchMemory.mockResolvedValue(memoryWith(entry, otherMemberEntry));
  api.saveMemory.mockResolvedValue({ ...entry, content: 'Updated rules.' });
  api.deleteMemory.mockResolvedValue({ status: 'deleted' });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'confirm');
});

describe('UtilitiesView shared-memory mutation refresh', () => {
  it('starts a fresh memory read after a successful save', async () => {
    render(<UtilitiesView kind="memory" />);

    fireEvent.click(await screen.findByRole('button', { name: /Rules/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Updated rules.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.saveMemory).toHaveBeenCalled());
    await waitFor(() => expect(api.fetchMemory).toHaveBeenCalledWith(
      undefined,
      { forceFresh: true },
    ));
  });
});

describe('UtilitiesView memory editor targeting', () => {
  it('writes the slot the draft was seeded from', async () => {
    render(<UtilitiesView kind="memory" />);

    fireEvent.click(await screen.findByRole('button', { name: /Rules/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Updated rules.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.saveMemory).toHaveBeenCalledWith({
      scope: 'Project',
      category: 'rules',
      content: 'Updated rules.',
      projectId: 'project-1',
    }));
  });

  // Regression: the editor stayed open when the sidebar moved, so the save
  // guard read another member's capability and refused a member's edit to
  // their own slot.
  it('leaves the editor when the sidebar moves to another members slot', async () => {
    render(<UtilitiesView kind="memory" />);

    fireEvent.click(await screen.findByRole('button', { name: /Rules/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Updated rules.' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Lessons/ }));

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent('Read only');
    expect(api.saveMemory).not.toHaveBeenCalled();
  });

  it('keeps the editor open while the sidebar stays on the edited slot', async () => {
    render(<UtilitiesView kind="memory" />);

    fireEvent.click(await screen.findByRole('button', { name: /Rules/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Updated rules.' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Rules/ }));

    expect(screen.getByRole('textbox')).toHaveValue('Updated rules.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});

describe('UtilitiesView memory capability gates', () => {
  it('offers edit and delete on a memory the server says is writable', async () => {
    Object.defineProperty(window, 'confirm', {
      configurable: true,
      value: vi.fn(() => true),
    });
    render(<UtilitiesView kind="memory" />);

    fireEvent.click(await screen.findByRole('button', { name: /Rules/ }));

    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(api.deleteMemory).toHaveBeenCalledWith({
      scope: 'Project',
      category: 'rules',
      projectId: 'project-1',
    }));
  });

  it('withholds edit and delete on a memory the server marked read only', async () => {
    render(<UtilitiesView kind="memory" />);

    fireEvent.click(await screen.findByRole('button', { name: /Lessons/ }));

    expect(screen.getByRole('note')).toHaveTextContent('Read only');
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('fails closed on hosted Cowork when the entry carries no capabilities', async () => {
    const undecided = { ...entry };
    delete undecided.capabilities;
    api.fetchMemory.mockResolvedValue(memoryWith(undecided));
    render(<UtilitiesView kind="memory" />);

    fireEvent.click(await screen.findByRole('button', { name: /Rules/ }));

    expect(screen.getByRole('note')).toHaveTextContent('Read only');
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
});

describe('UtilitiesView deployment-shared memory labels', () => {
  const raw = {
    scope: 'project',
    project_id: 'project-1',
    category: 'rules',
    content: 'Original rules.',
    capabilities: { canEdit: true, canDelete: true },
  };

  it('labels an unknown shared project in the list, selected entry and editor', async () => {
    api.fetchMemory.mockResolvedValue(groupMemoryItems([{ ...raw, deployment_shared: true }], []));
    render(<UtilitiesView kind="memory" />);

    expect(await screen.findByText('Project memory')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Rules/ }));
    expect(screen.getAllByText('Project memory')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getAllByText('Project memory')).toHaveLength(2);
    expect(screen.getByRole('textbox')).toHaveValue(raw.content);
    expect(screen.queryByText('Project · null')).toBeNull();
    expect(document.body.textContent).not.toContain(raw.project_id);
  });

  it.each([undefined, false, null, 'true', 1])(
    'preserves the unknown-project display without a true sharing marker (%s)',
    async (marker) => {
      const incoming = marker === undefined ? raw : { ...raw, deployment_shared: marker };
      api.fetchMemory.mockResolvedValue(groupMemoryItems([incoming], []));
      render(<UtilitiesView kind="memory" />);

      expect(await screen.findByText('Project · null')).toBeInTheDocument();
      expect(screen.queryByText('Project memory')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /Rules/ }));
      expect(screen.getByText('Project', { exact: true })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      expect(screen.getByText('Project', { exact: true })).toBeInTheDocument();
      expect(screen.queryByText('Project memory')).toBeNull();
    },
  );

  it.each([undefined, true])('retains a known projects display name with marker %s', async (marker) => {
    const projects = [{ id: raw.project_id, name: 'billing', display_name: 'Billing team' }];
    const incoming = marker === undefined ? raw : { ...raw, deployment_shared: marker };
    api.fetchMemory.mockResolvedValue(groupMemoryItems([incoming], projects));
    render(<UtilitiesView kind="memory" projects={projects} />);

    expect(await screen.findByText('Project · Billing team')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Rules/ }));
    expect(screen.getAllByText('Project · Billing team')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getAllByText('Project · Billing team')).toHaveLength(2);
    expect(screen.queryByText('Project memory')).toBeNull();
  });

  it('edits the selected tier when two shared projects have the same generic label', async () => {
    api.fetchMemory.mockResolvedValue(groupMemoryItems([
      { ...raw, deployment_shared: true },
      { ...raw, project_id: 'project-2', content: 'Answer in pallets.', deployment_shared: true },
    ], []));
    render(<UtilitiesView kind="memory" />);

    const buttons = await screen.findAllByRole('button', { name: /Rules/ });
    expect(screen.getAllByText('Project memory')).toHaveLength(2);
    fireEvent.click(buttons[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox')).toHaveValue('Answer in pallets.');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Answer in crates.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.saveMemory).toHaveBeenCalledWith({
      scope: 'Project',
      category: 'rules',
      content: 'Answer in crates.',
      projectId: 'project-2',
    }));
  });
});
