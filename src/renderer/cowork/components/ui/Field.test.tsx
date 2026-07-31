import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field } from './Field';

describe('Field', () => {
  it('renders a label and links it to the control via a generated id', () => {
    const { container } = render(
      <Field label="Project name">
        <input />
      </Field>,
    );
    const label = screen.getByText('Project name');
    const input = container.querySelector('input')!;
    expect(label.tagName).toBe('LABEL');
    expect(input.id).toBeTruthy();
    expect(label.getAttribute('for')).toBe(input.id);
  });

  it('respects an id already set on the control', () => {
    const { container } = render(
      <Field label="Name">
        <input id="custom-id" />
      </Field>,
    );
    const input = container.querySelector('input')!;
    expect(input.id).toBe('custom-id');
    expect(screen.getByText('Name').getAttribute('for')).toBe('custom-id');
  });

  it('renders help text and wires aria-describedby to it', () => {
    const { container } = render(
      <Field label="Name" help="Lowercase, no spaces.">
        <input />
      </Field>,
    );
    const input = container.querySelector('input')!;
    const help = screen.getByText('Lowercase, no spaces.');
    expect(input.getAttribute('aria-describedby')).toBe(help.id);
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toBeRequired();
  });

  it('preserves a descriptor id that resembles a utility class', () => {
    // Regression: composing aria-describedby with cn()/tailwind-merge would
    // drop ids that look like conflicting utilities. Plain join must keep both.
    const { container } = render(
      <Field label="Name" help="hint">
        <input aria-describedby="p-4" />
      </Field>,
    );
    const input = container.querySelector('input')!;
    const ids = input.getAttribute('aria-describedby')!.split(' ');
    expect(ids).toContain('p-4');
    expect(ids).toHaveLength(2);
  });

  it('renders an error as a live region and marks the control invalid', () => {
    const { container } = render(
      <Field label="API key" error="Key is required.">
        <input />
      </Field>,
    );
    const input = container.querySelector('input')!;
    const error = screen.getByText('Key is required.');
    expect(error).toHaveAttribute('role', 'alert');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(error.id);
  });

  it('shows the error instead of help when both are provided', () => {
    render(
      <Field label="Name" help="helpful" error="broken">
        <input />
      </Field>,
    );
    expect(screen.getByText('broken')).toBeInTheDocument();
    expect(screen.queryByText('helpful')).not.toBeInTheDocument();
  });

  it('exposes the required state on the control, not just the asterisk', () => {
    const { container } = render(
      <Field label="Name" required>
        <input />
      </Field>,
    );
    expect(screen.getByText('*')).toBeInTheDocument();
    const input = container.querySelector('input')!;
    expect(input).toBeRequired();
    expect(input.getAttribute('aria-required')).toBe('true');
  });

  it('renders the optional affordance', () => {
    render(
      <Field label="Name" optional>
        <input />
      </Field>,
    );
    expect(screen.getByText('(optional)')).toBeInTheDocument();
  });

  it('leaves a non-element child untouched instead of throwing', () => {
    expect(() => render(<Field label="Note">just text</Field>)).not.toThrow();
    expect(screen.getByText('just text')).toBeInTheDocument();
  });
});
