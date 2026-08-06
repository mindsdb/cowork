import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Collapsible } from './Collapsible';

describe('Collapsible', () => {
  it('renders a trigger button, collapsed by default (aria-expanded=false, no panel content)', () => {
    render(
      <Collapsible title="Advanced">
        <p>panel body</p>
      </Collapsible>,
    );
    const trigger = screen.getByRole('button', { name: /advanced/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('panel body')).toBeNull();
  });

  it('renders open with defaultOpen and shows the panel content', () => {
    render(
      <Collapsible title="Advanced" defaultOpen>
        <p>panel body</p>
      </Collapsible>,
    );
    const trigger = screen.getByRole('button', { name: /advanced/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // The chevron rotation + any adopter styling hangs off this attribute.
    expect(trigger.hasAttribute('data-panel-open')).toBe(true);
    expect(screen.getByText('panel body')).toBeTruthy();
  });

  it('reflects a controlled close (open=true → false)', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Collapsible title="Advanced" open onOpenChange={onOpenChange}>
        <p>panel body</p>
      </Collapsible>,
    );
    expect(screen.getByText('panel body')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
    rerender(
      <Collapsible title="Advanced" open={false} onOpenChange={onOpenChange}>
        <p>panel body</p>
      </Collapsible>,
    );
    expect(screen.queryByText('panel body')).toBeNull();
  });

  it('toggles open on trigger click (uncontrolled)', () => {
    render(
      <Collapsible title="Advanced">
        <p>panel body</p>
      </Collapsible>,
    );
    const trigger = screen.getByRole('button', { name: /advanced/i });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('panel body')).toBeTruthy();
  });

  it('honors controlled open + onOpenChange', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Collapsible title="Advanced" open={false} onOpenChange={onOpenChange}>
        <p>panel body</p>
      </Collapsible>,
    );
    const trigger = screen.getByRole('button', { name: /advanced/i });
    fireEvent.click(trigger);
    // Controlled: the click reports intent but does not self-open.
    expect(onOpenChange).toHaveBeenCalledWith(true, expect.anything());
    expect(screen.queryByText('panel body')).toBeNull();
    // Parent applies the new state.
    rerender(
      <Collapsible title="Advanced" open onOpenChange={onOpenChange}>
        <p>panel body</p>
      </Collapsible>,
    );
    expect(screen.getByText('panel body')).toBeTruthy();
  });

  it('does not open when disabled', () => {
    render(
      <Collapsible title="Advanced" disabled>
        <p>panel body</p>
      </Collapsible>,
    );
    const trigger = screen.getByRole('button', { name: /advanced/i });
    // Base UI marks disabled accessibly (aria-disabled + data-disabled) rather
    // than with the native attribute, so the control stays focusable. The
    // disabled affordance styling keys off data-disabled, not `:disabled`.
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    expect(trigger.hasAttribute('data-disabled')).toBe(true);
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('panel body')).toBeNull();
  });

  it('omits the chevron when hideChevron is set', () => {
    const { container, rerender } = render(
      <Collapsible title="Advanced">
        <p>body</p>
      </Collapsible>,
    );
    expect(container.querySelector('svg')).toBeTruthy();
    rerender(
      <Collapsible title="Advanced" hideChevron>
        <p>body</p>
      </Collapsible>,
    );
    expect(container.querySelector('svg')).toBeNull();
  });

  it('applies layout-only classNames to root, trigger, and panel', () => {
    const { container } = render(
      <Collapsible title="Advanced" defaultOpen className="mt-4" triggerClassName="px-3" panelClassName="pl-6">
        <p>body</p>
      </Collapsible>,
    );
    expect(container.firstElementChild!.className).toContain('mt-4');
    expect(screen.getByRole('button', { name: /advanced/i }).className).toContain('px-3');
    expect(container.querySelector('.pl-6')).toBeTruthy();
  });
});
