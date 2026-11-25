// The viewer's panel rail (ENG-4455): one icon tab per panel, pressed while
// its panel is open, named with a line on what it is for on hover and focus.

import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ViewerModeRail } from './ViewerModeRail';

const tabs = (over = {}) => [
  { id: 'source', icon: <svg />, label: 'Live edit', description: 'Change text and layout on the page', pressed: false, onSelect: vi.fn(), ...over.source },
  { id: 'comments', icon: <svg />, label: 'Comments', description: 'Leave and review feedback', pressed: false, onSelect: vi.fn(), ...over.comments },
  { id: 'stats', icon: <svg />, label: 'Stats', description: 'Who viewed and for how long', pressed: false, onSelect: vi.fn(), ...over.stats },
];

describe('ViewerModeRail', () => {
  it('renders one icon tab per panel, in order, pressed while its panel is open', () => {
    render(<ViewerModeRail label="Viewer panels" tabs={tabs({ comments: { pressed: true } })} panelId="side" />);

    const rail = screen.getByRole('toolbar', { name: 'Viewer panels' });
    expect(rail).toHaveAttribute('aria-orientation', 'vertical');
    const buttons = within(rail).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Live edit', 'Comments', 'Stats']);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    // Only the open tab points at the panel it opened.
    expect(buttons[1]).toHaveAttribute('aria-controls', 'side');
    expect(buttons[0]).not.toHaveAttribute('aria-controls');
    // Icons only: no visible label text on the rail.
    expect(rail).not.toHaveTextContent('Live edit');
  });

  it('renders nothing without a tab', () => {
    const { container } = render(<ViewerModeRail label="Viewer panels" tabs={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('describes each tab, and shows its name and description on hover', async () => {
    const user = userEvent.setup();
    render(<ViewerModeRail label="Viewer panels" tabs={tabs()} />);

    const live = screen.getByRole('button', { name: 'Live edit' });
    expect(live).toHaveAccessibleDescription('Change text and layout on the page');

    await user.hover(live);
    const tip = await screen.findByText('Change text and layout on the page', { selector: '.artifact-mode-rail-tip span' });
    expect(tip.closest('.artifact-mode-rail-tip')).toHaveTextContent('Live edit');
    // Not a <strong>: the dark theme paints every strong in the ink colour,
    // which is the tooltip's background there.
    expect(tip.closest('.artifact-mode-rail-tip').querySelector('strong')).toBeNull();
  });

  it('shows the tooltip on keyboard focus too', async () => {
    const user = userEvent.setup();
    render(<ViewerModeRail label="Viewer panels" tabs={tabs()} />);

    await user.tab();
    expect(screen.getByRole('button', { name: 'Live edit' })).toHaveFocus();
    expect(await screen.findByText('Change text and layout on the page', { selector: '.artifact-mode-rail-tip span' })).toBeInTheDocument();
  });

  it('selects a tab on click, whether it is open or not', () => {
    const all = tabs({ stats: { pressed: true } });
    render(<ViewerModeRail label="Viewer panels" tabs={all} />);

    fireEvent.click(screen.getByRole('button', { name: 'Comments' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stats' }));

    expect(all[1].onSelect).toHaveBeenCalledTimes(1);
    expect(all[2].onSelect).toHaveBeenCalledTimes(1);
  });

  it('moves between tabs with the arrow keys, Home and End', () => {
    render(<ViewerModeRail label="Viewer panels" tabs={tabs()} />);
    const [live, comments, stats] = screen.getAllByRole('button');
    live.focus();

    fireEvent.keyDown(live, { key: 'ArrowDown' });
    expect(comments).toHaveFocus();
    fireEvent.keyDown(comments, { key: 'End' });
    expect(stats).toHaveFocus();
    fireEvent.keyDown(stats, { key: 'ArrowDown' });
    expect(live).toHaveFocus();
    fireEvent.keyDown(live, { key: 'ArrowUp' });
    expect(stats).toHaveFocus();
    fireEvent.keyDown(stats, { key: 'Home' });
    expect(live).toHaveFocus();
  });

  it('badges unread comments and names them in the label', () => {
    render(
      <ViewerModeRail
        label="Viewer panels"
        tabs={tabs({ comments: { badge: 3, badgeLabel: 'Comments, 3 unread' } })}
      />,
    );

    const comments = screen.getByRole('button', { name: 'Comments, 3 unread' });
    expect(comments.parentElement.querySelector('.artifact-feedback-badge')).toHaveTextContent('3');
  });

  describe('actions', () => {
    const openChat = (over = {}) => ({
      id: 'open-chat',
      icon: <svg />,
      label: 'Open chat',
      description: 'Close the preview and go to the chat this was made in',
      onSelect: vi.fn(),
      ...over,
    });

    it('renders an action after the tabs, as a plain button with no pressed state', () => {
      render(<ViewerModeRail label="Viewer panels" tabs={tabs()} actions={[openChat()]} />);

      const buttons = within(screen.getByRole('toolbar')).getAllByRole('button');
      expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Live edit', 'Comments', 'Stats', 'Open chat']);
      const action = buttons[3];
      expect(action).not.toHaveAttribute('aria-pressed');
      expect(action).not.toHaveAttribute('aria-controls');
      expect(action).not.toHaveAttribute('aria-disabled');
      expect(action.closest('.artifact-mode-rail-actions')).not.toBeNull();
    });

    it('renders an action alone, with no tab', () => {
      render(<ViewerModeRail label="Viewer panels" tabs={[]} actions={[openChat()]} />);
      expect(screen.getByRole('button', { name: 'Open chat' })).toBeInTheDocument();
    });

    it('runs an enabled action on click', () => {
      const action = openChat();
      render(<ViewerModeRail label="Viewer panels" tabs={tabs()} actions={[action]} />);
      fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));
      expect(action.onSelect).toHaveBeenCalledTimes(1);
    });

    it('keeps a disabled action focusable, never runs it, and says why on hover', async () => {
      const user = userEvent.setup();
      const action = openChat({ disabled: true, description: 'The chat this was made in has been deleted' });
      render(<ViewerModeRail label="Viewer panels" tabs={tabs()} actions={[action]} />);

      const button = screen.getByRole('button', { name: 'Open chat' });
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).not.toBeDisabled();
      expect(button).toHaveAccessibleDescription('The chat this was made in has been deleted');
      await user.hover(button);
      const tip = await screen.findByText('The chat this was made in has been deleted', { selector: '.artifact-mode-rail-tip span' });
      expect(tip.closest('.artifact-mode-rail-tip')).toHaveTextContent('Open chat');
      await user.click(button);
      expect(action.onSelect).not.toHaveBeenCalled();
    });

    it('names a disabled action with no reason yet, and describes nothing', () => {
      render(<ViewerModeRail label="Viewer panels" tabs={tabs()} actions={[openChat({ disabled: true, description: '' })]} />);
      const button = screen.getByRole('button', { name: 'Open chat' });
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).not.toHaveAttribute('aria-describedby');
    });

    it('reaches the action with the arrow keys', () => {
      render(<ViewerModeRail label="Viewer panels" tabs={tabs()} actions={[openChat()]} />);
      const buttons = screen.getAllByRole('button');
      buttons[2].focus();
      fireEvent.keyDown(buttons[2], { key: 'ArrowDown' });
      expect(buttons[3]).toHaveFocus();
    });
  });
});
