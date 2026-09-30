import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AppTitlebar from './AppTitlebar';
import { AppHeader, AppHeaderProvider, AppHeaderScope, AppAttention } from './appHeader';

const props = (over = {}) => ({
  lightsInset: 78,
  docked: true,
  onToggleSidebar: vi.fn(),
  toggleLabel: 'Collapse sidebar',
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
  it('keeps the sidebar toggle and search in the row, docked or not', () => {
    const p = props();
    const { rerender } = shell(p);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(p.onToggleSidebar).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(p.onOpenSearch).toHaveBeenCalledOnce();
    // Docked, the sidebar's own New task CTA is visible, so no shortcut here.
    expect(screen.queryByRole('button', { name: 'New task' })).toBeNull();

    rerender(
      <AppHeaderProvider>
        <AppTitlebar {...p} docked={false} toggleLabel="Open sidebar" />
      </AppHeaderProvider>,
    );
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    expect(p.onNewTask).toHaveBeenCalledOnce();
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
