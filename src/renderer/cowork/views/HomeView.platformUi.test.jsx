import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: false }));

import HomeView from './HomeView';

it('asks the operator to configure the provider without settings or signup offers', () => {
  const onOpenSettings = vi.fn();
  const { container } = render(
    <HomeView greeting="Good morning" activeTasks={[]} skipIntro serverOnline configReady={false} onOpenSettings={onOpenSettings} />,
  );
  expect(screen.getByText('Provider setup is required')).toBeInTheDocument();
  expect(screen.getByText('Ask your operator to configure the model provider before starting a task.')).toBeInTheDocument();
  expect(container).not.toHaveTextContent(/MindsHub|Start for free|allowance/i);
  expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
  expect(onOpenSettings).not.toHaveBeenCalled();
});
