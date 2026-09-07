// The card replaces a machine prompt in the transcript, so what it must NOT do
// matters as much as what it shows: no identifiers, and no claim about an
// outcome it could not confirm.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const wsMock = vi.hoisted(() => ({ loadAgentRepair: vi.fn() }));
vi.mock('../lib/artifactWorkspaceApi', () => wsMock);

import ArtifactRepairCard from './ArtifactRepairCard';

const REPAIR = {
  artifactId: 'b01a187163174d24944ac838a331c90f',
  repairId: '1af96d6e-2214-4cd2-a475-0008f5b99b92',
  sourcePath: 'store.html',
  baseRevisionId: '4f5a2be1-a7af-4580-881c-a3565c53b93f',
  selector: '',
  thread: [{ author: 'jorge@mindsdb.com', text: 'title should be harbor and pines' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  wsMock.loadAgentRepair.mockResolvedValue({ repair: { status: 'queued' } });
});

describe('ArtifactRepairCard', () => {
  it('shows the reviewer comment and the file, not the machine identifiers', async () => {
    render(<ArtifactRepairCard repair={REPAIR} projectId="proj-1" streaming />);

    expect(screen.getByText('title should be harbor and pines')).toBeInTheDocument();
    expect(screen.getByText('store.html')).toBeInTheDocument();
    expect(screen.getByText('jorge@mindsdb.com')).toBeInTheDocument();
    // The whole point of the card: these must not reach the transcript.
    expect(screen.queryByText(/b01a1871/)).toBeNull();
    expect(screen.queryByText(/1af96d6e/)).toBeNull();
    expect(screen.queryByText(/4f5a2be1/)).toBeNull();
  });

  it('reads "Making changes" while the repair is queued', async () => {
    render(<ArtifactRepairCard repair={REPAIR} projectId="proj-1" streaming />);

    await waitFor(() => expect(screen.getByText('Making changes')).toBeInTheDocument());
  });

  it('moves to the finished state once the repair resolves', async () => {
    wsMock.loadAgentRepair.mockResolvedValue({ repair: { status: 'ready' } });
    render(<ArtifactRepairCard repair={REPAIR} projectId="proj-1" streaming={false} />);

    await waitFor(() =>
      expect(screen.getByText('Changes ready to review')).toBeInTheDocument());
  });

  it('reports a resolved repair even while the turn is still streaming', async () => {
    // A turn can keep going after the repair is done; the server's answer wins.
    wsMock.loadAgentRepair.mockResolvedValue({ repair: { status: 'no_change' } });
    render(<ArtifactRepairCard repair={REPAIR} projectId="proj-1" streaming />);

    await waitFor(() =>
      expect(screen.getByText('No changes were needed')).toBeInTheDocument());
  });

  it('degrades to a neutral state when the lookup fails', async () => {
    wsMock.loadAgentRepair.mockRejectedValue(new Error('offline'));
    render(<ArtifactRepairCard repair={REPAIR} projectId="proj-1" streaming={false} />);

    await waitFor(() => expect(screen.getByText('Sent to the agent')).toBeInTheDocument());
    // Still shows what was asked — that part never depended on the lookup.
    expect(screen.getByText('title should be harbor and pines')).toBeInTheDocument();
  });

  it('shows a real selector and omits the empty one', async () => {
    const { rerender } = render(
      <ArtifactRepairCard repair={REPAIR} projectId="proj-1" streaming />,
    );
    expect(screen.queryByText('General artifact feedback')).toBeNull();

    rerender(
      <ArtifactRepairCard
        repair={{ ...REPAIR, selector: 'header > h1.title' }}
        projectId="proj-1"
        streaming
      />,
    );
    expect(screen.getByText('header > h1.title')).toBeInTheDocument();
  });

  it('addresses the repair by artifact id and project', async () => {
    render(<ArtifactRepairCard repair={REPAIR} projectId="proj-1" streaming />);

    await waitFor(() => expect(wsMock.loadAgentRepair).toHaveBeenCalledWith(
      { id: REPAIR.artifactId, projectId: 'proj-1' },
      REPAIR.repairId,
    ));
  });
});
