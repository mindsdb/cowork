import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Button from './Button';

describe('Button', () => {
  it('renders a type="button" by default (never submits a form by accident)', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('composes classes from variant/size/flags; md+default add no extra tokens', () => {
    render(<Button>Plain</Button>);
    expect(screen.getByRole('button', { name: 'Plain' })).toHaveClass('btn', { exact: true });

    render(
      <Button variant="danger" size="sm" icon block className="extra" aria-label="Del">
        x
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Del' });
    for (const cls of ['btn', 'danger', 'sm', 'icon', 'block', 'extra']) {
      expect(btn).toHaveClass(cls);
    }
  });

  it('falls back to default variant/size on unknown values instead of leaking junk classes', () => {
    render(<Button variant="sparkly" size="xxl">Odd</Button>);
    expect(screen.getByRole('button', { name: 'Odd' })).toHaveClass('btn', { exact: true });
  });

  it('forwards rest props: click handlers fire, disabled blocks them', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <>
        <Button onClick={onClick}>Go</Button>
        <Button onClick={onClick} disabled>
          Frozen
        </Button>
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Frozen' }));
    expect(onClick).toHaveBeenCalledTimes(1); // unchanged
    expect(screen.getByRole('button', { name: 'Frozen' })).toBeDisabled();
  });
});
