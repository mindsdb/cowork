import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NavProvider, useNavigate, useParams, useLoaderData, useRoute, hrefFor, Link } from './router';

// host defaults to isWeb in the test env; pin it so the Link web-passthrough branch
// is deterministic.
vi.mock('../../platform/host', () => ({ host: { isWeb: true } }));

const wrap = (value, ui) => render(<NavProvider value={value}>{ui}</NavProvider>);

describe('hrefFor', () => {
  it('home is the clean root', () => {
    expect(hrefFor({ to: 'home' })).toBe('/');
  });
  it('builds a conversation deep link', () => {
    expect(hrefFor({ to: 'task', params: { c: 'abc' } })).toBe('?view=task&c=abc');
  });
  it('encodes a project name', () => {
    expect(hrefFor({ to: 'projects', params: { p: 'My Proj' } })).toBe('?view=projects&p=My+Proj');
  });
  it('never links a tmp- conversation id', () => {
    expect(hrefFor({ to: 'task', params: { c: 'tmp-1' } })).toBe('?view=task');
  });
});

describe('hooks', () => {
  const value = {
    route: 'task',
    params: { c: 'abc' },
    loaderData: { id: 'abc', title: 'Hello' },
    navigate: vi.fn(),
  };

  function Probe() {
    const navigate = useNavigate();
    return (
      <div>
        <span data-testid="route">{useRoute()}</span>
        <span data-testid="c">{useParams().c}</span>
        <span data-testid="title">{useLoaderData().title}</span>
        <button onClick={() => navigate({ to: 'home' })}>go</button>
      </div>
    );
  }

  it('expose the provider values and dispatch navigate', () => {
    wrap(value, <Probe />);
    expect(screen.getByTestId('route').textContent).toBe('task');
    expect(screen.getByTestId('c').textContent).toBe('abc');
    expect(screen.getByTestId('title').textContent).toBe('Hello');
    fireEvent.click(screen.getByText('go'));
    expect(value.navigate).toHaveBeenCalledWith({ to: 'home' });
  });

  it('throw when used outside a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/within <NavProvider>/);
    spy.mockRestore();
  });
});

describe('Link', () => {
  const navigate = vi.fn();
  const value = { route: 'home', params: {}, loaderData: null, navigate };
  beforeEach(() => navigate.mockClear());

  it('renders an anchor whose href matches navigating there', () => {
    wrap(value, <Link to="task" params={{ c: 'abc' }}>Open</Link>);
    const a = screen.getByText('Open');
    expect(a.tagName).toBe('A');
    expect(a.getAttribute('href')).toBe('?view=task&c=abc');
  });

  it('a plain click dispatches navigate and prevents default', () => {
    wrap(value, <Link to="task" params={{ c: 'abc' }}>Open</Link>);
    const a = screen.getByText('Open');
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    a.dispatchEvent(ev);
    expect(navigate).toHaveBeenCalledWith({ to: 'task', params: { c: 'abc' } });
    expect(ev.defaultPrevented).toBe(true);
  });

  it('honours a caller onClick that prevents default (no navigate)', () => {
    const onClick = vi.fn((e) => e.preventDefault());
    wrap(value, <Link to="task" onClick={onClick}>Open</Link>);
    fireEvent.click(screen.getByText('Open'));
    expect(onClick).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('leaves a modified click to the browser on web (open in new tab)', () => {
    wrap(value, <Link to="task" params={{ c: 'abc' }}>Open</Link>);
    fireEvent.click(screen.getByText('Open'), { metaKey: true });
    expect(navigate).not.toHaveBeenCalled();
  });
});
