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

  it('renders required and optional affordances', () => {
    const { rerender } = render(
      <Field label="Name" required>
        <input />
      </Field>,
    );
    expect(screen.getByText('*')).toBeInTheDocument();
    rerender(
      <Field label="Name" optional>
        <input />
      </Field>,
    );
    expect(screen.getByText('(optional)')).toBeInTheDocument();
  });
});
