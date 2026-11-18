import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReportContentButton } from './ReportContentButton';
import { setOrgMode } from '../../../lib/orgMode';
import { reportContent, reportArtifactContent } from '../../api';
vi.mock('../../api', () => ({ reportContent: vi.fn(), reportArtifactContent: vi.fn() }));
afterEach(() => { setOrgMode(false); vi.resetAllMocks(); });
describe('report content', () => {
  it('asks for consent and shows receipt only after the server accepts', async () => {
    setOrgMode(true);
    let done!: (value: { id: string; status: "received" }) => void;
    vi.mocked(reportContent).mockImplementation(() => new Promise<{ id: string; status: "received" }>(resolve => { done = resolve; }));
    render(<ReportContentButton conversationId="task" messageId="answer" />);
    fireEvent.click(screen.getByRole('button', { name: 'Report content' }));
    expect(reportContent).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Send report' }));
    expect(reportContent).toHaveBeenCalledWith('task', 'answer');
    expect(screen.queryByText('Report received.')).not.toBeInTheDocument();
    done({ id: "report", status: "received" });
    expect(await screen.findByText('Report received.')).toBeInTheDocument();
  });
  it('keeps failures retryable without claiming success', async () => {
    setOrgMode(true);
    vi.mocked(reportContent).mockRejectedValue(new Error('offline'));
    render(<ReportContentButton conversationId="task" messageId="answer" />);
    fireEvent.click(screen.getByRole('button', { name: 'Report content' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send report' }));
    expect(await screen.findByText('Could not send the report. Please try again.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send report' })).toBeEnabled());
    expect(screen.queryByText('Report received.')).not.toBeInTheDocument();
  });
  it('reports a shared artifact through its own authorized endpoint', async () => {
    setOrgMode(true);
    vi.mocked(reportArtifactContent).mockResolvedValue({ id: 'report', status: 'received' });
    render(<ReportContentButton artifactTarget={{ projectId: 'project', artifactId: 'artifact' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Report content' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send report' }));
    expect(await screen.findByText('Report received.')).toBeInTheDocument();
    expect(reportArtifactContent).toHaveBeenCalledWith('project', 'artifact');
    expect(reportContent).not.toHaveBeenCalled();
  });
  it('does not offer reporting on a local deployment', () => {
    render(<ReportContentButton conversationId="task" messageId="answer" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
