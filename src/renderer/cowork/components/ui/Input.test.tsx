import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from './Input';

describe('Input', () => {
  it('renders a bare input (no group wrapper) when there are no adornments', () => {
    const { container } = render(<Input value="hi" onChange={() => {}} className="w-40" />);
    const input = container.querySelector('input')!;
    expect(input).toBeTruthy();
    expect(input.className).toContain('field-input');
    // className applies to the input in the plain path (unchanged behaviour).
    expect(input.className).toContain('w-40');
    expect(container.querySelector('.field-group')).toBeNull();
  });

  it('reports value changes as (value, event)', () => {
    const onChange = vi.fn();
    render(<Input value="" onChange={onChange} placeholder="p" />);
    fireEvent.change(screen.getByPlaceholderText('p'), { target: { value: 'x' } });
    expect(onChange).toHaveBeenCalledWith('x', expect.anything());
  });

  it('wraps the input in a field-group with both adornments in order', () => {
    const { container } = render(
      <Input value="" onChange={() => {}} leading={<span>L</span>} trailing={<span>T</span>} />,
    );
    const group = container.querySelector('.field-group')!;
    expect(group).toBeTruthy();
    const addons = group.querySelectorAll('.field-group__addon');
    expect(addons).toHaveLength(2);
    expect(addons[0].textContent).toBe('L');
    expect(addons[1].textContent).toBe('T');
    // The control still carries `.field-input`; CSS makes it borderless in-group.
    expect(group.querySelector('input.field-input')).toBeTruthy();
  });

  it('renders only the provided adornment side', () => {
    const { container } = render(<Input value="" onChange={() => {}} leading={<span>L</span>} />);
    expect(container.querySelector('.field-group')).toBeTruthy();
    expect(container.querySelectorAll('.field-group__addon')).toHaveLength(1);
  });

  it('treats a falsy adornment as absent (no empty group / addon)', () => {
    // The `leading={cond && <Icon/>}` idiom yields `false` when off — it must
    // render the bare input, not a group with an empty gap-consuming addon.
    const { container } = render(
      <Input value="" onChange={() => {}} leading={false} trailing={null} />,
    );
    expect(container.querySelector('.field-group')).toBeNull();
    expect(container.querySelectorAll('.field-group__addon')).toHaveLength(0);
    expect(container.querySelector('input.field-input')).toBeTruthy();
  });

  it('still fires onChange when adorned and forwards native attrs (type) through', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Input type="password" value="" onChange={onChange} trailing={<button>show</button>} />,
    );
    const input = container.querySelector('input')!;
    expect(input.getAttribute('type')).toBe('password');
    fireEvent.change(input, { target: { value: 's3cret' } });
    expect(onChange).toHaveBeenCalledWith('s3cret', expect.anything());
  });

  it('puts wrapperClassName + size on the group and size on the input', () => {
    const { container } = render(
      <Input value="" onChange={() => {}} size="sm" wrapperClassName="basis-80" leading={<span>L</span>} />,
    );
    const group = container.querySelector('.field-group')!;
    expect(group.className).toContain('sm');
    expect(group.className).toContain('basis-80');
    expect(container.querySelector('input')!.className).toContain('sm');
  });

  it('forwards a ref to the underlying input even when adorned', () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<Input value="" onChange={() => {}} ref={ref} leading={<span>L</span>} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});
