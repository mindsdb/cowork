import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: false }));

import HomeView from './HomeView';

it('offers provider settings without a platform signup when configuration is missing', () => {
  const onOpenSettings = vi.fn();
  const { container } = render(
    <HomeView greeting="Good morning" activeTasks={[]} skipIntro serverOnline configReady={false} onOpenSettings={onOpenSettings} />,
  );
  expect(screen.getByText(/Add an API key or configure an endpoint in Settings/)).toBeInTheDocument();
  expect(container).not.toHaveTextContent(/MindsHub|Start for free|allowance/i);
  fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }));
  expect(onOpenSettings).toHaveBeenCalledWith('agent');
});
