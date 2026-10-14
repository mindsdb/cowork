import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AppTitlebar, { SidebarToggle } from './AppTitlebar';
import { AppHeader, AppHeaderProvider, AppHeaderScope, AppAttention } from './appHeader';

const props = (over = {}) => ({
  lightsInset: 78,
  docked: true,
  onNewTask: vi.fn(),
  newTaskLabel: 'New task',
  brand: { wordmark: 'MindsHub', logo: null, mode: 'cowork', showSwitch: false, onChange: vi.fn() },
  onOpenSearch: vi.fn(),
  searchShortcut: '⌘K',
  ...over,
});

const shell = (titlebar, children) => render(
  <AppHeaderProvider>
    <AppTitlebar {...titlebar} />
    {children}
  </AppHeaderProvider>,
);

describe('AppTitlebar', () => {
  it('takes the new-task shortcut and compact brand only while the sidebar is hidden', () => {
    const p = props({ brand: { ...props().brand, showSwitch: true } });
    const { rerender } = shell(p);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(p.onOpenSearch).toHaveBeenCalledOnce();
    // Docked, the brand and New task CTA live in the sidebar column.
    expect(screen.queryByRole('button', { name: 'New task' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Workspace' })).toBeNull();

    rerender(
      <AppHeaderProvider>
        <AppTitlebar {...p} docked={false} />
      </AppHeaderProvider>,
    );
    expect(screen.getByRole('group', { name: 'Workspace' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    expect(p.onNewTask).toHaveBeenCalledOnce();
  });

  it('pins the sidebar toggle beside the window controls', () => {
    const onToggle = vi.fn();
    render(<SidebarToggle lightsInset={78} label="Collapse sidebar" onToggle={onToggle} />);
    const button = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(button.parentElement).toHaveStyle({ left: '78px' });
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('portals the active view header into the row', () => {
    shell(props(), (
      <main>
        <AppHeader><span>Q3 launch › Draft</span></AppHeader>
      </main>
    ));
    const row = screen.getByTestId('app-titlebar');
    expect(row).toHaveTextContent('Q3 launch › Draft');
    expect(screen.getByRole('main')).not.toHaveTextContent('Q3 launch');
  });

  it('writes only the visible workspace into the header slot', () => {
    shell(props(), (
      <>
        <AppHeaderScope active={false}><AppHeader><span>hidden cowork header</span></AppHeader></AppHeaderScope>
        <AppHeaderScope active><AppHeader><span>visible code header</span></AppHeader></AppHeaderScope>
      </>
    ));
    const row = screen.getByTestId('app-titlebar');
    expect(row).toHaveTextContent('visible code header');
    expect(screen.queryByText('hidden cowork header')).toBeNull();
  });

  it('shows app-wide attention regardless of workspace scope', () => {
    shell(props(), (
      <AppHeaderScope active={false}>
        <AppAttention><button type="button">1 task needs you</button></AppAttention>
      </AppHeaderScope>
    ));
    expect(screen.getByTestId('app-titlebar')).toHaveTextContent('1 task needs you');
  });
});

describe('AppHeader without a titlebar', () => {
  it('renders inline, as on mobile', () => {
    render(<main><AppHeader><span>inline crumbs</span></AppHeader></main>);
    expect(screen.getByRole('main')).toHaveTextContent('inline crumbs');
  });

  it('renders the attention fallback in place', () => {
    render(<AppAttention fallback={<span>bar</span>}><span>bell</span></AppAttention>);
    expect(screen.getByText('bar')).toBeInTheDocument();
    expect(screen.queryByText('bell')).toBeNull();
  });
});
