import { createRef } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CardGrid, ItemCard } from './ItemCard';
import { ListGroup, ListItem, ListNotice, NewRow } from './ListGroup';
import { HoverActions } from './itemParts';
import { StatusDot } from './StatusDot';

describe.each([
  ['ItemCard', ItemCard],
  ['ListItem', ListItem],
] as const)('%s', (_name, Item) => {
  it('renders every slot', () => {
    render(
      <Item
        leading={<span>logo</span>}
        title="Gmail"
        badges={<span>Built-in</span>}
        description="work@example.com"
        meta={<StatusDot tone="success">Connected</StatusDot>}
      >
        <p>extra</p>
      </Item>,
    );
    for (const text of ['logo', 'Gmail', 'Built-in', 'work@example.com', 'Connected', 'extra']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  it('opens from a real button named by the title, or by activateLabel', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const { rerender } = render(<Item title="Daily digest" onActivate={onActivate} />);
    await user.click(screen.getByRole('button', { name: 'Daily digest' }));
    rerender(<Item title="Daily digest" onActivate={onActivate} activateLabel="Open Daily digest" />);
    await user.click(screen.getByRole('button', { name: 'Open Daily digest' }));
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('opens with the keyboard', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(<Item title="Daily digest" onActivate={onActivate} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Daily digest' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('renders the title as plain text and the item as no button without onActivate', () => {
    render(<Item title="Read only" />);
    expect(screen.getByText('Read only')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('stays an <article> with nested real buttons when as="article"', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    const onDisconnect = vi.fn();
    const ref = createRef<HTMLElement>();
    render(
      <Item
        ref={ref}
        as="article"
        title="Gmail"
        onActivate={onActivate}
        activateLabel="Manage Gmail"
        meta={<HoverActions reveal><button type="button" onClick={onDisconnect}>Disconnect</button></HoverActions>}
      />,
    );
    const article = screen.getByRole('article');
    expect(ref.current).toBe(article);
    expect(article).not.toHaveAttribute('role');
    expect(article).not.toHaveAttribute('tabindex');
    await user.click(within(article).getByRole('button', { name: 'Disconnect' }));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
    await user.click(within(article).getByRole('button', { name: 'Manage Gmail' }));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('busy dims the item, marks it aria-busy, and disables opening', () => {
    render(<Item as="article" title="Gmail" onActivate={() => {}} busy />);
    expect(screen.getByRole('article')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Gmail' })).toBeDisabled();
  });

  // Positioning is pinned by class (jsdom computes no Tailwind CSS): an
  // overlaid cluster is `absolute`, an in-flow one is not.
  it('overlays hidden actions but keeps revealed ones in flow, so they never cover the title or meta', () => {
    const { rerender } = render(<Item title="Weekly report" actions={<button type="button">More</button>} />);
    const cluster = () => screen.getByRole('button', { name: 'More' }).closest('[data-item-actions]');
    expect(cluster()).toHaveClass('absolute', '[@media(hover:none)]:static', '[@media(pointer:coarse)]:static');
    rerender(<Item title="Weekly report" revealActions actions={<button type="button">More</button>} />);
    expect(cluster()).not.toHaveClass('absolute');
    expect(cluster()).not.toHaveClass('opacity-0');
  });

  it('keeps hover actions in the tab order after the activator, so keyboard users reach them', async () => {
    const user = userEvent.setup();
    const onMenu = vi.fn();
    render(
      <Item
        title="Weekly report"
        onActivate={() => {}}
        actions={<button type="button" aria-label="More actions" onClick={onMenu} />}
      />,
    );
    await user.tab();
    expect(screen.getByRole('button', { name: 'Weekly report' })).toHaveFocus();
    await user.tab();
    const more = screen.getByRole('button', { name: 'More actions' });
    expect(more).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onMenu).toHaveBeenCalledTimes(1);
  });
});

describe('HoverActions', () => {
  // jsdom computes no Tailwind CSS, so the reveal contract is pinned by the
  // variants that implement it: focus-within, an open menu, and touch.
  it('hides at rest and reveals on hover, focus-within, an open menu, and touch (incl. coarse pointers)', () => {
    render(<HoverActions><button type="button">Edit</button></HoverActions>);
    const cluster = screen.getByRole('button', { name: 'Edit' }).parentElement!;
    expect(cluster).toHaveClass(
      'opacity-0',
      'pointer-events-none',
      'group-hover/item:opacity-100',
      'group-focus-within/item:opacity-100',
      'group-focus-within/item:pointer-events-auto',
      'has-[[data-popup-open]]:opacity-100',
      '[@media(hover:none)]:opacity-100',
      '[@media(pointer:coarse)]:opacity-100',
    );
  });

  it('reveal keeps the cluster visible and clickable at rest', () => {
    render(<HoverActions reveal><button type="button">Disconnect</button></HoverActions>);
    const cluster = screen.getByRole('button', { name: 'Disconnect' }).parentElement!;
    expect(cluster).not.toHaveClass('opacity-0');
    expect(cluster).not.toHaveClass('pointer-events-none');
  });
});

describe('ListItem reserveActions', () => {
  it('keeps hidden actions in flow instead of overlaying a control in the meta', () => {
    render(<ListItem title="Deck" reserveActions meta={<a href="#p">Project</a>} actions={<button type="button">More</button>} />);
    const cluster = screen.getByRole('button', { name: 'More' }).closest('[data-item-actions]');
    expect(cluster).not.toHaveClass('absolute');
    expect(cluster).toHaveClass('opacity-0');
  });
});

describe('ListGroup density', () => {
  it('renders a header and passes its density to rows, which may override it', () => {
    render(
      <ListGroup title={<h2>GitHub</h2>} description="Draft PRs" actions={<button type="button">Connect</button>} density="compact">
        <ListItem title="octocat" />
        <ListItem title="hubot" density="comfortable" />
        <ListNotice>Waiting for GitHub…</ListNotice>
      </ListGroup>,
    );
    expect(screen.getByRole('heading', { name: 'GitHub' })).toBeInTheDocument();
    expect(screen.getByText('Draft PRs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    const row = (title: string) => screen.getByText(title).closest('.group\\/item');
    expect(row('octocat')).toHaveClass('px-3', 'py-2.5');
    expect(row('octocat')).not.toHaveClass('min-h-[60px]');
    expect(row('hubot')).toHaveClass('px-4', 'py-3', 'min-h-[60px]');
    expect(screen.getByText('Waiting for GitHub…')).toHaveClass('px-3', 'py-2.5');
  });

  it('defaults to comfortable without a header', () => {
    render(<ListGroup><ListItem title="Daily digest" /></ListGroup>);
    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.getByText('Daily digest').closest('.group\\/item')).toHaveClass('px-4', 'py-3');
  });
});

describe('NewRow', () => {
  it('is a button named by its label', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ListGroup><NewRow label="New schedule" onClick={onClick} /></ListGroup>);
    await user.click(screen.getByRole('button', { name: 'New schedule' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('CardGrid', () => {
  it('lays its children out in the shared grid and takes layout classes', () => {
    render(<CardGrid className="px-8"><ItemCard title="Alpha" /></CardGrid>);
    expect(screen.getByText('Alpha').closest('.grid')).toHaveClass('px-8');
  });
});

describe('StatusDot', () => {
  it('shows its label next to a decorative dot', () => {
    render(<StatusDot tone="danger">Last run failed</StatusDot>);
    const status = screen.getByText('Last run failed');
    expect(status).toHaveClass('text-danger');
    expect(status.querySelector('[aria-hidden="true"]')).toHaveClass('bg-danger');
  });
});
