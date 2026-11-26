// ENG-4684: the inline artifacts and widgets live on screen, for the voice
// operator: the snapshot's `widgets`, set_widget_state and submit_widget.
import { afterEach, describe, expect, it, vi } from 'vitest';

const inline = vi.hoisted(() => ({ states: new Map(), set: vi.fn() }));
vi.mock('../../components/artifact/useInlineArtifactState', () => ({
  latestInlineState: (artifact) => inline.states.get(artifact.slug),
  setInlineArtifactState: (...args) => inline.set(...args),
}));

import {
  MAX_WIDGETS, MAX_WIDGET_EXCERPT_CHARS, showWidgetOnScreen, widgetActions, widgetsOnScreen,
} from './screenWidgets';

const card = (slug, over = {}) => ({ slug, title: slug.toUpperCase(), file_path: `/a/${slug}/index.html`, display: 'widget', ...over });
const closers = [];
const show = (read) => { const close = showWidgetOnScreen(read); closers.push(close); return close; };

afterEach(() => {
  closers.splice(0).forEach((close) => close());
  inline.states.clear();
  inline.set.mockReset();
});

describe('widgetsOnScreen', () => {
  it('describes each live frame, the latest first: key, title, display, state, excerpt and submittable', () => {
    inline.states.set('pick', { picked: ['a'] });
    show(() => ({ artifact: card('chart', { display: 'inline' }), html: '<h1>Revenue</h1><script>x()</script><p>by month</p>' }));
    show(() => ({ artifact: card('pick'), html: '', onSubmit: () => {} }));

    expect(widgetsOnScreen()).toEqual([
      { key: 'pick', title: 'PICK', display: 'widget', state: { picked: ['a'] }, excerpt: '', submittable: true },
      { key: 'chart', title: 'CHART', display: 'inline', state: null, excerpt: 'Revenue by month', submittable: false },
    ]);
  });

  it('keeps at most three, one per artifact, skipping readers that fail or have nothing', () => {
    show(() => ({ artifact: card('a') }));
    show(() => { throw new Error('gone'); });
    show(() => null);
    show(() => ({ artifact: card('b') }));
    show(() => ({ artifact: card('c') }));
    // The viewer on `c`, opened over its card: one widget, the viewer's.
    show(() => ({ artifact: card('c'), onSubmit: () => {} }));
    show(() => ({ artifact: card('d') }));

    const widgets = widgetsOnScreen();
    expect(widgets.map((w) => w.key)).toEqual(['d', 'c', 'b']);
    expect(widgets).toHaveLength(MAX_WIDGETS);
    expect(widgets[1].submittable).toBe(true);
  });

  it('cuts the excerpt to 1500 characters, and forgets a frame once unmounted', () => {
    const close = show(() => ({ artifact: card('long'), html: `<p>${'word '.repeat(1000)}</p>` }));
    expect(widgetsOnScreen()[0].excerpt.length).toBe(MAX_WIDGET_EXCERPT_CHARS);
    close();
    expect(widgetsOnScreen()).toEqual([]);
  });
});

describe('set_widget_state', () => {
  it("sets the state the way a frame's own change goes, and says so", () => {
    const artifact = card('pick');
    show(() => ({ artifact }));
    inline.set.mockReturnValue(true);
    const { set_widget_state: setState } = widgetActions();

    expect(setState({ key: 'pick', state: { picked: ['b'] } })).toBe('Set the state of "PICK".');
    expect(inline.set).toHaveBeenCalledWith(artifact, { picked: ['b'] });
  });

  it('answers an unknown key, a state that is not an object, and one that could not be set', () => {
    show(() => ({ artifact: card('pick') }));
    const { set_widget_state: setState } = widgetActions();

    expect(setState({ key: 'nope', state: {} })).toBe('There is no widget on screen with the key "nope".');
    expect(setState({ key: 'pick', state: [1] })).toBe('The state must be a JSON object.');
    expect(setState({ key: 'pick', state: null })).toBe('The state must be a JSON object.');
    expect(setState({ key: 'pick', state: '{"a":1}' })).toBe('The state must be a JSON object.');
    expect(inline.set).not.toHaveBeenCalled();
    inline.set.mockReturnValue(false);
    expect(setState({ key: 'pick', state: { a: 1 } })).toMatch(/could not be set/);
  });
});

describe('submit_widget', () => {
  it("sends the frame's Submit with the latest state and the message", () => {
    const onSubmit = vi.fn();
    inline.states.set('pick', { picked: ['a', 'c'] });
    show(() => ({ artifact: card('pick'), onSubmit }));
    const { submit_widget: submit } = widgetActions();

    expect(submit({ key: 'pick', message: 'Go with these' })).toBe('Submitted "PICK".');
    expect(onSubmit).toHaveBeenCalledWith({ state: { picked: ['a', 'c'] }, message: 'Go with these' });
    submit({ key: 'pick' });
    expect(onSubmit).toHaveBeenLastCalledWith({ state: { picked: ['a', 'c'] }, message: '' });
  });

  it('answers an unknown key, and a frame with no Submit', () => {
    show(() => ({ artifact: card('chart', { display: 'inline' }) }));
    const { submit_widget: submit } = widgetActions();
    expect(submit({ key: 'nope' })).toBe('There is no widget on screen with the key "nope".');
    expect(submit({ key: 'chart' })).toBe('"CHART" can\'t be submitted from here.');
  });
});
