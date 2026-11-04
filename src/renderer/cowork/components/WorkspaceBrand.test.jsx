import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SidebarBrand, WorkspaceSwitch, isWideLogo } from './WorkspaceBrand';

const loadLogo = (img, width, height) => {
  Object.defineProperty(img, 'naturalWidth', { configurable: true, value: width });
  Object.defineProperty(img, 'naturalHeight', { configurable: true, value: height });
  fireEvent.load(img);
};

describe('SidebarBrand', () => {
  it('shows the wordmark', () => {
    render(<SidebarBrand wordmark="MindsHub" logo={null} />);
    expect(screen.getByText('MindsHub')).toBeInTheDocument();
  });

  it('shows a custom title beside a square logo', () => {
    render(<SidebarBrand wordmark="Acme Workspace" logo="data:image/png;base64,abc123" />);
    const img = document.querySelector('.anton-sidebar__logo');
    expect(img.getAttribute('src')).toBe('data:image/png;base64,abc123');
    loadLogo(img, 64, 64);
    expect(screen.getByText('Acme Workspace')).toBeInTheDocument();
    expect(img).not.toHaveClass('is-wide');
  });

  it('lets a wide logo stand alone, named by the title', () => {
    render(<SidebarBrand wordmark="Acme Workspace" logo="data:image/png;base64,wide" />);
    loadLogo(document.querySelector('.anton-sidebar__logo'), 400, 60);
    expect(screen.queryByText('Acme Workspace')).toBeNull();
    expect(screen.getByRole('img', { name: 'Acme Workspace' })).toHaveClass('is-wide');
  });

  it('measures a replaced logo afresh', () => {
    const { rerender } = render(<SidebarBrand wordmark="Acme" logo="data:image/png;base64,wide" />);
    loadLogo(document.querySelector('.anton-sidebar__logo'), 400, 60);
    rerender(<SidebarBrand wordmark="Acme" logo="data:image/png;base64,square" />);
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });
});

describe('SidebarBrand mark', () => {
  it('shows the stock mark only for the stock product', () => {
    const { rerender } = render(<SidebarBrand wordmark="MindsHub" logo={null} stockMark />);
    expect(document.querySelector('.app-brand__mark')).not.toBeNull();
    // A custom name without a logo stands alone.
    rerender(<SidebarBrand wordmark="Lumen Labs" logo={null} stockMark={false} />);
    expect(document.querySelector('.app-brand__mark')).toBeNull();
    // A logo replaces the mark.
    rerender(<SidebarBrand wordmark="MindsHub" logo="data:image/png;base64,abc" stockMark />);
    expect(document.querySelector('.app-brand__mark')).toBeNull();
  });
});

describe('SidebarBrand search', () => {
  it('opens search from the end of the row', async () => {
    const onOpenSearch = vi.fn();
    render(<SidebarBrand wordmark="MindsHub" logo={null} onOpenSearch={onOpenSearch} searchShortcut="⌘K" />);
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(onOpenSearch).toHaveBeenCalledOnce();
  });

  it('draws no search button without a handler', () => {
    render(<SidebarBrand wordmark="MindsHub" logo={null} />);
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
  });
});

describe('isWideLogo', () => {
  it('reads a logo twice as wide as it is tall as a lockup', () => {
    expect(isWideLogo(200, 100)).toBe(true);
    expect(isWideLogo(150, 100)).toBe(false);
    expect(isWideLogo(0, 0)).toBe(false);
  });
});

describe('WorkspaceSwitch', () => {
  it('switches to Code', async () => {
    const onChange = vi.fn();
    render(<WorkspaceSwitch mode="cowork" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Cowork' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Code' }));
    expect(onChange).toHaveBeenCalledWith('code');
  });

  it('names each mode on hover', async () => {
    render(<WorkspaceSwitch mode="cowork" onChange={() => {}} />);
    await userEvent.hover(screen.getByRole('button', { name: 'Code' }));
    expect(await screen.findByText('Code mode')).toBeInTheDocument();
  });

  it('does not re-select the current workspace', async () => {
    const onChange = vi.fn();
    render(<WorkspaceSwitch mode="code" onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Code' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is icon-only, named by each mode', () => {
    render(<WorkspaceSwitch mode="cowork" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Code' })).not.toHaveTextContent('Code');
    expect(screen.getByRole('button', { name: 'Cowork' })).not.toHaveTextContent('Cowork');
  });
});
