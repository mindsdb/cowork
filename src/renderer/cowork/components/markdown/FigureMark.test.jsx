import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/* Counts each render of the Base UI roots FigureMark mounts, so a test can
   tell a mark that has mounted neither from one that has. */
const roots = vi.hoisted(() => ({ popover: 0, tooltip: 0 }));
vi.mock('@base-ui/react/popover', async (importOriginal) => {
  const mod = await importOriginal();
  const Root = (props) => {
    roots.popover += 1;
    return <mod.Popover.Root {...props} />;
  };
  return { ...mod, Popover: { ...mod.Popover, Root } };
});
vi.mock('@base-ui/react/tooltip', async (importOriginal) => {
  const mod = await importOriginal();
  const Root = (props) => {
    roots.tooltip += 1;
    return <mod.Tooltip.Root {...props} />;
  };
  return { ...mod, Tooltip: { ...mod.Tooltip, Root } };
});
vi.mock('../../lib/clipboard', () => ({ copyText: vi.fn(async () => true) }));

import { FigureMark } from './FigureMark';
import { NO_SOURCE_TEXT } from '../../lib/figureSources';
import { copyText } from '../../lib/clipboard';

/* A source the way linkFigureSteps hands it over. */
const source = (tool_use_id, kind, label, extra = {}) => ({
  tool_use_id,
  kind,
  label,
  path: null,
  attachment_id: null,
  url: null,
  queries: [],
  requests: [],
  page: null,
  stepId: null,
  project_id: null,
  ...extra,
});
const STOCK = source('toolu_01', 'file', 'stock.csv', { path: 'data/stock.csv', stepId: 'step-1' });
const UPLOAD = source('toolu_02', 'file', 'stock.csv', { attachment_id: 'file-123' });
const QUERY = source('toolu_03', 'query', 'Query stock', { queries: ['SELECT qty FROM stock'] });
const API = source('toolu_04', 'query', 'Read the ERP', {
  requests: [`GET {DS_ERP_URL}/inventory?site=S1&sku=${'x'.repeat(80)}`],
});

const sourced = (text, sources) => ({ start: 0, end: text.length, text, origin: 'step', sources });
const unsourced = (text) => ({ start: 0, end: text.length, text, origin: 'none', sources: [] });

const mark = (figure, props = {}) => (
  <FigureMark figure={figure} {...props}>{figure.text}</FigureMark>
);

beforeEach(() => {
  roots.popover = 0;
  roots.tooltip = 0;
  vi.mocked(copyText).mockReset().mockResolvedValue(true);
});

describe('FigureMark accessible name', () => {
  it('names a sourced figure by its first source\'s kind and describes it with the tooltip sentence', () => {
    const { container } = render(<p>{mark(sourced('250', [STOCK, QUERY]))}</p>);
    const button = screen.getByRole('button', { name: '250, from a file' });
    expect(button).toHaveAccessibleDescription('From stock.csv and 1 more');
    // The description is not part of the answer's own text.
    expect(container.textContent).toBe('250');
  });

  it('keeps "no source" in an unsourced figure\'s name', () => {
    render(<p>{mark(unsourced('$30'))}</p>);
    expect(screen.getByRole('button', { name: '$30, no source' })).toHaveAccessibleDescription(NO_SOURCE_TEXT);
  });
});

describe('FigureMark mounting', () => {
  it('mounts no tooltip or popover until a figure is hovered or clicked', async () => {
    render(<p>{mark(sourced('250', [STOCK]))} and {mark(unsourced('$30'))}</p>);
    expect(roots).toEqual({ popover: 0, tooltip: 0 });

    await userEvent.hover(screen.getByRole('button', { name: '250, from a file' }));
    expect(await screen.findByText('From stock.csv')).toBeVisible();
    expect(roots.popover).toBe(0);

    await userEvent.click(screen.getByRole('button', { name: '$30, no source' }));
    expect(await screen.findByRole('dialog', { name: 'Where $30 came from' })).toBeInTheDocument();
  });

  it('shows the tooltip on keyboard focus and hides it on Escape, keeping focus on the figure', async () => {
    render(<p>{mark(sourced('250', [STOCK]))}</p>);
    const button = screen.getByRole('button', { name: '250, from a file' });
    await userEvent.tab();
    expect(button).toHaveFocus();
    expect(await screen.findByText('From stock.csv')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('From stock.csv')).toBeNull());
    expect(button).toHaveFocus();
  });

  it('hides the tooltip when the pointer leaves the figure', async () => {
    render(<p>{mark(sourced('250', [STOCK]))}</p>);
    const button = screen.getByRole('button', { name: '250, from a file' });
    await userEvent.hover(button);
    expect(await screen.findByText('From stock.csv')).toBeVisible();
    await userEvent.unhover(button);
    await waitFor(() => expect(screen.queryByText('From stock.csv')).toBeNull());
  });

  it('says the popover is open on the figure while it is, and gives focus back on Escape', async () => {
    render(<p>{mark(sourced('250', [STOCK]))}</p>);
    const button = screen.getByRole('button', { name: '250, from a file' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    button.focus();
    await userEvent.keyboard('{Enter}');
    const popup = await screen.findByRole('dialog', { name: 'Where 250 came from' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('data-popup-open');
    expect(button).toHaveAttribute('aria-controls', popup.id);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });
});

describe('FigureMark in a table', () => {
  const tableAnswer = () => render(
    <div>
      <p>{mark(sourced('12', [STOCK]))}</p>
      <table>
        <tbody>
          <tr><td>{mark(sourced('250', [STOCK]))}</td><td>{mark(unsourced('$30'))}</td></tr>
          <tr><td>{mark(sourced('40', [QUERY]))}</td><td>plain</td></tr>
        </tbody>
      </table>
      <button type="button">after</button>
    </div>,
  );

  it('gives the table one tab stop, however many figures it holds', async () => {
    const { container } = tableAnswer();
    const stops = [...container.querySelectorAll('button')].filter((b) => b.tabIndex >= 0);
    expect(stops.map((b) => b.textContent)).toEqual(['12', '250', 'after']);

    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: '250, from a file' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus();
  });

  it('moves between the table\'s figures with the arrow keys, and Tab comes back to the last one', async () => {
    tableAnswer();
    screen.getByRole('button', { name: '250, from a file' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: '$30, no source' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: '40, from a query' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('button', { name: '250, from a file' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: '40, from a query' })).toHaveFocus();
  });

  it('tells a keyboard user on the table\'s first figure that the arrow keys move between them', () => {
    tableAnswer();
    expect(screen.getByRole('button', { name: '250, from a file' }))
      .toHaveAccessibleDescription('From stock.csv. Arrow keys move between the figures in this table.');
    expect(screen.getByRole('button', { name: '$30, no source' })).toHaveAccessibleDescription(NO_SOURCE_TEXT);
    expect(screen.getByRole('button', { name: '12, from a file' })).toHaveAccessibleDescription('From stock.csv');
  });

  it('shows the arrow-key hint in the tooltip that keyboard focus opens', async () => {
    tableAnswer();
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: '250, from a file' })).toHaveFocus();
    expect(await screen.findByText('From stock.csv. Arrow keys move between the figures in this table.')).toBeVisible();
  });

  it('leaves the arrow-key hint out of the tooltip a mouse opens', async () => {
    tableAnswer();
    await userEvent.hover(screen.getByRole('button', { name: '250, from a file' }));
    expect(await screen.findByText('From stock.csv')).toBeVisible();
    expect(screen.queryByText(/Arrow keys/)).toBeNull();
  });

  it('gives a table with one figure no arrow-key hint, since there is no other figure to move to', async () => {
    render(<table><tbody><tr><td>S1</td><td>{mark(sourced('250', [STOCK]))}</td></tr></tbody></table>);
    const button = screen.getByRole('button', { name: '250, from a file' });
    expect(button).toHaveAccessibleDescription('From stock.csv');
    await userEvent.tab();
    expect(button).toHaveFocus();
    expect(await screen.findByText('From stock.csv')).toBeVisible();
  });
});

describe('FigureMark popover', () => {
  const openPopover = async (figure, props) => {
    render(<p>{mark(figure, props)}</p>);
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${figure.text.replace('$', '\\$')},`) }));
    return screen.findByRole('dialog');
  };

  it('stays within the space Base UI measures beside the figure, and keeps a scroll inside its list', async () => {
    const popup = await openPopover(sourced('250', [STOCK, QUERY]));
    expect(popup.style.maxHeight).toContain('var(--available-height');
    expect(within(popup).getByRole('list')).toHaveClass('overscroll-contain', 'min-h-0');
  });

  it('is as wide as its content, between 240px and 440px', async () => {
    const popup = await openPopover(sourced('340', [STOCK]));
    expect(popup.style.width).toBe('max-content');
    expect(popup.style.minWidth).toContain('240px');
    expect(popup.style.maxWidth).toContain('440px');
  });

  it('titles itself at the size of its source rows, in bold', async () => {
    const popup = await openPopover(sourced('340', [STOCK]));
    const title = within(popup).getByRole('heading', { name: 'Where 340 came from' });
    expect(title).not.toHaveClass('s-h3');
    expect(title).toHaveClass('text-[13px]', 'font-semibold');
  });

  it('ends a long label in an ellipsis, with the whole label on hover', async () => {
    const name = 'q3-2026-inventory-snapshot-by-site-and-part-exported-from-the-planning-system.csv';
    const popup = await openPopover(sourced('96', [source('toolu_08', 'file', name, { path: `exports/${name}` })]));
    const label = within(popup).getByTitle(name);
    expect(label).toHaveTextContent(name);
    expect(label).toHaveClass('truncate', 'min-w-0');
  });

  it('offers "View file" for a file attached to the chat and hands over the source', async () => {
    const onViewFile = vi.fn();
    const popup = await openPopover(sourced('250', [UPLOAD]), { onViewFile });
    await userEvent.click(within(popup).getByRole('button', { name: /View file/ }));
    expect(onViewFile).toHaveBeenCalledExactlyOnceWith(UPLOAD);
  });

  it('wraps a long request, and leaves SQL lines as written', async () => {
    const popup = await openPopover(sourced('250', [QUERY, API]));
    const [sql, request] = popup.querySelectorAll('code');
    expect(sql.style.whiteSpace).toBe('pre');
    expect(request.style.whiteSpace).toBe('pre-wrap');
    expect(request.style.overflowWrap).toBe('anywhere');
  });

  it('names a source the server sent no label for by its kind alone', async () => {
    const popup = await openPopover(sourced('250', [source('toolu_05', 'query', '', { queries: ['SELECT 1'] })]));
    const [item] = within(popup).getAllByRole('listitem');
    expect(item.firstChild).toHaveTextContent(/^Query$/);
  });

  it('says so when a copy fails', async () => {
    vi.mocked(copyText).mockResolvedValue(false);
    const popup = await openPopover(sourced('250', [QUERY]));
    await userEvent.click(within(popup).getByRole('button', { name: 'Copy SQL' }));
    expect(await within(popup).findByRole('button', { name: 'Could not copy' })).toHaveTextContent('Could not copy');
  });
});

/* The underline is the only thing that sets a figure apart in its sentence.
   Forced-colors mode paints every line one system color, so "no source" must
   differ from a sourced figure in shape, and the light theme's sourced line
   must reach 3:1 on its ground (--ink-4 is 2.55:1, --ink-3 4.85:1). */
describe('FigureMark underline (globals.css)', () => {
  const css = readFileSync(resolve(__dirname, '../../styles/globals.css'), 'utf8');
  const block = (selectorStart) => {
    const at = css.indexOf(`\n${selectorStart}`);
    expect(at).toBeGreaterThan(-1);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };
  const prop = (body, name) => new RegExp(`(?:^|[;\\s])${name}:\\s*([^;]+);`).exec(body)?.[1].trim();

  it('draws "no source" in another line shape than a sourced figure', () => {
    const sourced = prop(block('.anton-figure {'), 'text-decoration-style');
    const unsourced = prop(block('.anton-figure--unsourced'), 'text-decoration-style');
    expect(sourced).toBe('dotted');
    expect(unsourced).toBeDefined();
    expect(unsourced).not.toBe(sourced);
  });

  it("gives the light theme's sourced line --ink-3, and the dark theme's --ink-4", () => {
    expect(prop(block('.anton-figure {'), '--figure-line')).toBe('var(--ink-3)');
    expect(prop(block('body[data-theme="dark"] .anton-figure {'), '--figure-line')).toBe('var(--ink-4)');
  });
});
