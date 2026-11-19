import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.hoisted(() => {
  window.COWORK_DEPLOYMENT_BRAND = { productName: '' };
});
vi.mock('../lib/deployment', () => ({ PLATFORM_UI: false }));

import ScheduleTaskModal from './components/schedule/ScheduleTaskModal';

describe('scheduled tasks with an invalid brand name', () => {
  it.each([undefined, { id: 's1', title: 'Digest', prompt: 'Summarize', cadence: 'daily', enabled: true }])(
    'keeps the harness label in create and edit mode (%j)', (task) => {
      render(<ScheduleTaskModal open onClose={vi.fn()} onSubmit={vi.fn()} projects={[]} agentLabel="Anton" task={task} />);
      expect(screen.getByPlaceholderText('Ask Anton to…')).toBeInTheDocument();
      expect(screen.getByText(task
        ? 'What should Anton do?'
        : 'Anton runs this on its own, even with this tab closed.')).toBeInTheDocument();
    },
  );
});
