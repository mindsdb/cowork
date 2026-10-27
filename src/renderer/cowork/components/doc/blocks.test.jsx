// The smaller blocks: a code block follows changes made elsewhere, keeps what
// is typed into it, and its "Copied" note does not outlive it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CodeBlock, DocImageLoader, ImageBlock, MetricsBlock } from './blocks';
import { PendingEdits } from './useSaveIndicator';

afterEach(() => { vi.useRealTimers(); });

const code = (extra) => ({ id: 'b_c', type: 'code', language: 'js', code: 'let a = 1;', ...extra });

describe('CodeBlock', () => {
  it('shows a language the agent sets', () => {
    // Found in review: the language box read its value once, so a change from
    // the agent or another window never showed.
    const { rerender } = render(<CodeBlock block={code()} editable onOps={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Code language' })).toHaveValue('js');
    rerender(<CodeBlock block={code({ language: 'python' })} editable onOps={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Code language' })).toHaveValue('python');
  });

  it('keeps the language being typed, and saves it on leaving', () => {
    const onOps = vi.fn();
    const { rerender } = render(<CodeBlock block={code()} editable onOps={onOps} />);
    const lang = screen.getByRole('textbox', { name: 'Code language' });
    fireEvent.focus(lang);
    fireEvent.change(lang, { target: { value: 'ts' } });
    rerender(<CodeBlock block={code({ code: 'let b = 2;' })} editable onOps={onOps} />);
    expect(lang).toHaveValue('ts');
    fireEvent.blur(lang);
    expect(onOps).toHaveBeenCalledWith([{ op: 'update', id: 'b_c', set: { language: 'ts' } }]);
  });

  it('saves nothing when the language did not change', () => {
    const onOps = vi.fn();
    render(<CodeBlock block={code()} editable onOps={onOps} />);
    const lang = screen.getByRole('textbox', { name: 'Code language' });
    fireEvent.focus(lang);
    fireEvent.blur(lang);
    expect(onOps).not.toHaveBeenCalled();
  });

  it('saves the code on leaving it', () => {
    const onOps = vi.fn();
    render(<CodeBlock block={code()} editable onOps={onOps} />);
    const box = screen.getByRole('textbox', { name: 'Code' });
    fireEvent.change(box, { target: { value: 'let a = 2;' } });
    fireEvent.blur(box);
    expect(onOps).toHaveBeenCalledWith([{ op: 'update', id: 'b_c', set: { code: 'let a = 2;' } }]);
  });

  it('says typed code is waiting until it is saved', () => {
    const onPendingChange = vi.fn();
    render(
      <PendingEdits.Provider value={onPendingChange}>
        <CodeBlock block={code()} editable onOps={() => {}} />
      </PendingEdits.Provider>,
    );
    const box = screen.getByRole('textbox', { name: 'Code' });
    fireEvent.change(box, { target: { value: 'let a = 2;' } });
    fireEvent.change(box, { target: { value: 'let a = 3;' } });
    expect(onPendingChange.mock.calls.map((c) => c[1])).toEqual([true]);
    fireEvent.blur(box);
    expect(onPendingChange.mock.calls.map((c) => c[1])).toEqual([true, false]);
  });

  it('saves code typed just before it goes away', () => {
    // Found in review: code was saved only on blur, so closing the doc from
    // the keyboard (or the block re-rendering) right after typing lost it.
    const onOps = vi.fn();
    const onPendingChange = vi.fn();
    const { unmount } = render(
      <PendingEdits.Provider value={onPendingChange}>
        <CodeBlock block={code()} editable onOps={onOps} />
      </PendingEdits.Provider>,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Code' }), { target: { value: 'let a = 2;' } });
    unmount();
    expect(onOps).toHaveBeenCalledWith([{ op: 'update', id: 'b_c', set: { code: 'let a = 2;' } }]);
    expect(onPendingChange).toHaveBeenLastCalledWith(expect.any(String), false);
  });

  it('saves nothing as it goes when nothing was typed', () => {
    const onOps = vi.fn();
    const { unmount } = render(<CodeBlock block={code()} editable onOps={onOps} />);
    unmount();
    expect(onOps).not.toHaveBeenCalled();
  });

  it('says Copied for a moment, and leaves no timer behind when it goes', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => {}) }, configurable: true });
    const { unmount } = render(<CodeBlock block={code()} editable onOps={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy code' })); });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('let a = 1;');
    expect(screen.getByText('Copied')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1300); });
    expect(screen.queryByText('Copied')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy code' })); });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('MetricsBlock', () => {
  it('saves one figure of several', () => {
    const onOps = vi.fn();
    const block = { id: 'b_m', type: 'metrics', items: [{ label: 'ARR', value: '$4M', delta: '+8%', tone: 'good' }, { label: 'Churn', value: '2%' }] };
    render(<MetricsBlock block={block} editable onOps={onOps} />);
    const value = screen.getByText('$4M');
    value.focus();
    value.textContent = '$5M';
    fireEvent.input(value);
    fireEvent.blur(value);
    expect(onOps).toHaveBeenCalledWith([{ op: 'update', id: 'b_m', set: { items: [{ ...block.items[0], value: '$5M' }, block.items[1]] } }]);
  });
});


describe('ImageBlock', () => {
  it('shows an image beside the doc from what the loader fetched, and a web image as it is', async () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    const load = vi.fn((src) => (src.startsWith('images/') ? Promise.resolve(blob) : null));
    URL.createObjectURL = vi.fn(() => 'blob:local-1');
    URL.revokeObjectURL = vi.fn();
    const { unmount } = render(
      <DocImageLoader.Provider value={load}>
        <ImageBlock block={{ id: 'b_i', type: 'image', src: 'images/abc.png', alt: 'Logo' }} editable={false} onOps={() => {}} />
        <ImageBlock block={{ id: 'b_w', type: 'image', src: 'https://example.com/a.png', alt: 'Web' }} editable={false} onOps={() => {}} />
      </DocImageLoader.Provider>,
    );
    expect(await screen.findByRole('img', { name: 'Logo' })).toHaveAttribute('src', 'blob:local-1');
    expect(screen.getByRole('img', { name: 'Web' })).toHaveAttribute('src', 'https://example.com/a.png');
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-1');
  });
});
