import userEvent from '@testing-library/user-event';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DecisionTray, isTrayShortcut } from './DecisionTray';


describe('DecisionTray actions slot', () => {
  function renderTray() {
    const allow = vi.fn();
    const deny = vi.fn();
    const always = vi.fn();
    const view = render(
      <DecisionTray
        label="Approval required"
        kind="Terminal"
        actions={{
          secondary: { label: 'Deny', onClick: deny, shortcut: 'Escape' },
          primary: { label: 'Allow once', onClick: allow, shortcut: 'Enter' },
          overflow: [{ label: 'Always allow', onClick: always }],
        }}
        onKeyDown={(event) => {
          if (isTrayShortcut(event, 'Escape')) { event.preventDefault(); deny(); }
          else if (isTrayShortcut(event, 'Enter') && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); allow(); }
        }}
      >
        <h2>Run this command?</h2>
      </DecisionTray>,
    );
    return { ...view, allow, deny, always };
  }

  it('renders the actions as the tray’s last row, so it stays pinned above the composer', () => {
    const { container } = renderTray();
    const row = container.querySelector('.code-decision-tray > .code-decision-tray__actions:last-child');
    expect(row).not.toBeNull();
    expect(row).toContainElement(screen.getByRole('button', { name: 'Allow once' }));
  });

  it('keeps tray shortcuts with the card while the buttons announce them', () => {
    const { allow, deny } = renderTray();
    const tray = screen.getByRole('region', { name: 'Approval required' });
    expect(tray).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Allow once' })).toHaveAttribute('aria-keyshortcuts', 'Enter');

    fireEvent.keyDown(tray, { key: 'Enter' });
    fireEvent.keyDown(tray, { key: 'Escape' });
    expect(allow).toHaveBeenCalledOnce();
    expect(deny).toHaveBeenCalledOnce();
  });

  it('reaches the rest through the overflow menu', async () => {
    const user = userEvent.setup();
    const { always } = renderTray();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Always allow' }));
    expect(always).toHaveBeenCalledOnce();
  });
});


describe('DecisionTray form', () => {
  it('wraps the body and actions in one form, so a submit action and Enter in a field both submit it', async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(
      <DecisionTray label="Agent questions" onSubmit={submit} actions={{ primary: { label: 'Continue', type: 'submit' } }}>
        <input aria-label="Answer" />
      </DecisionTray>,
    );
    const form = screen.getByRole('textbox', { name: 'Answer' }).closest('form');
    expect(form?.parentElement).toBe(screen.getByRole('region', { name: 'Agent questions' }));
    expect(form?.lastElementChild).toHaveClass('code-decision-tray__actions');
    expect(screen.getByRole('button', { name: 'Continue' }).closest('form')).toBe(form);

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(screen.getByRole('textbox', { name: 'Answer' }), 'yes{Enter}');
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('adds no form without onSubmit, so its buttons never submit an outer one', () => {
    const { container } = render(<DecisionTray label="Review plan" actions={{ primary: { label: 'Build' } }} />);
    expect(container.querySelector('form')).toBeNull();
    expect(screen.getByRole('button', { name: 'Build' })).toHaveAttribute('type', 'button');
  });
});
