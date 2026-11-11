import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../lib/deployment', () => ({ PLATFORM_UI: false }));

afterEach(() => {
  window.COWORK_DEPLOYMENT_BRAND = {};
  vi.resetModules();
});

describe.each([
  ['A'.repeat(32) + '🚀'.repeat(17), true],
  ['A'.repeat(32) + '🚀'.repeat(33), false],
])('scheduled tasks with Unicode brand %j', (name, valid) => {
  it.each([undefined, { id: 's1', title: 'Digest', prompt: 'Summarize', cadence: 'daily', enabled: true }])(
    'uses the validated name in create and edit mode (%j)', async (task) => {
      // Branding is read once at page load. Import the real parser and modal
      // after supplying this page's config, without mocking the brand helper.
      vi.resetModules();
      window.COWORK_DEPLOYMENT_BRAND = { productName: name };
      const { default: ScheduleTaskModal } = await import('./components/schedule/ScheduleTaskModal');
      render(<ScheduleTaskModal open onClose={vi.fn()} onSubmit={vi.fn()} projects={[]} agentLabel="Anton" task={task} />);
      const displayedName = valid ? name : 'Anton';
      expect(screen.getByPlaceholderText(`Ask ${displayedName} to…`)).toBeInTheDocument();
      expect(screen.getByText(task
        ? `What should ${displayedName} do?`
        : `${displayedName} runs this on its own, even with this tab closed.`)).toBeInTheDocument();
    },
  );
});
