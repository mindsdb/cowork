import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StepRow } from './StepRow';

describe('StepRow', () => {
  it('draws a row with nothing to open as plain text, not a button', () => {
    render(<StepRow icon="read" verb="Read" target="api.ts" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('api.ts')).toHaveClass('step-row__target');
  });

  it('calls onActivate from a real button, so the keyboard reaches it', () => {
    const onActivate = vi.fn();
    render(<StepRow variant="timeline" icon="cube" target="Signups dashboard" onActivate={onActivate} />);
    const button = screen.getByRole('button', { name: /Signups dashboard/ });
    expect(button).not.toHaveAttribute('aria-expanded');
    fireEvent.click(button);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('toggles its detail', () => {
    render(<StepRow icon="command" verb="Ran" target="npm test" detail={() => <pre>ok</pre>} />);
    const button = screen.getByRole('button', { name: /Ran npm test/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('ok')).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('ok')).toBeVisible();
    expect(button.closest('.step-row')).toHaveClass('is-open');
  });

  it('marks a failed row with a status word and tints the glyph and verb', () => {
    const { container } = render(<StepRow icon="command" verb="Ran" target="npm test" status="failed" />);
    expect(container.querySelector('.step-row')).toHaveClass('is-failed');
    expect(container.querySelector('.step-row')).toHaveAttribute('data-status', 'failed');
    expect(screen.getByText('Failed')).toHaveClass('text-danger');
    expect(container.querySelector('.step-row__icon')).toHaveClass('text-danger');
    expect(screen.getByText('Ran')).toHaveClass('text-danger');
  });

  it('lets a surface name its own failure', () => {
    render(<StepRow variant="timeline" icon="code" target="Running code" status="failed" statusLabel="Timed out" />);
    expect(screen.getByText('Timed out')).toBeVisible();
    expect(screen.queryByText('Failed')).toBeNull();
  });

  it('marks a recovered row with a quiet dot, not a failure word', () => {
    render(<StepRow variant="timeline" icon="code" target="Running code" status="recovered" />);
    expect(screen.getByRole('img', { name: 'Ended with an error' })).toBeInTheDocument();
    expect(screen.queryByText('Failed')).toBeNull();
  });

  it('animates a running row and hides its duration', () => {
    const { container } = render(<StepRow variant="timeline" icon="code" target="Running code" status="running" duration="5s" />);
    expect(container.querySelector('span.w-5')).toBeTruthy();
    expect(container.textContent).not.toContain('5s');
  });

  it('shows the duration and tag on a settled timeline row', () => {
    render(<StepRow variant="timeline" icon="cube" target="Digest" duration="3s" tag="skill" />);
    expect(screen.getByText('3s')).toBeVisible();
    expect(screen.getByText('skill')).toBeVisible();
  });
});
