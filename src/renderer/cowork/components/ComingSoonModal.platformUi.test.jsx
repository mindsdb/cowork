import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../lib/deployment', () => ({ PLATFORM_UI: false }));

import ComingSoonModal from './ComingSoonModal';

it('explains an unavailable feature without a desktop download offer', () => {
  const onClose = vi.fn();
  render(<ComingSoonModal feature="Channels" onClose={onClose} />);
  expect(screen.getByText('Feature unavailable')).toBeInTheDocument();
  expect(screen.getByText('Channels isn’t available in this deployment.')).toBeInTheDocument();
  expect(screen.queryByText(/download|desktop|Cloud/i)).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'Close' }).at(-1));
  expect(onClose).toHaveBeenCalledTimes(1);
});
