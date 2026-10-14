// The header's preview-errors button (ENG-3002): errors the previewed page
// reported about itself, behind one button instead of a banner that showed
// the first message and a "(+N more)" that led nowhere.
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import { PreviewErrorsButton } from './PreviewErrorsButton';

const ERRORS = [
  {
    message: "SecurityError: Failed to read the 'localStorage' property",
    file: 'https://cowork.example/api/v1/artifacts/drafts/p/a/index.html?v=3',
    line: 44,
  },
  { message: 'Failed to load script https://cdn.example/lib.js', file: '', line: 0 },
];

const diagnosticsOf = (errors, extra = {}) => ({
  errors,
  dismissed: false,
  dismiss: vi.fn(),
  ...extra,
});

const errorsButton = () => screen.queryByRole('button', { name: /^Preview errors/ });

describe('PreviewErrorsButton', () => {
  it('is absent while the preview has reported nothing', () => {
    render(<PreviewErrorsButton diagnostics={diagnosticsOf([])} />);

    expect(errorsButton()).toBeNull();
  });

  it('carries the count in its accessible name, like the comments button', () => {
    render(<PreviewErrorsButton diagnostics={diagnosticsOf(ERRORS)} />);

    expect(errorsButton()).toHaveAccessibleName('Preview errors, 2');
  });

  it('lists every message, not just the first', () => {
    render(<PreviewErrorsButton diagnostics={diagnosticsOf(ERRORS)} />);

    fireEvent.click(errorsButton());

    const popup = screen.getByRole('dialog');
    expect(popup).toHaveAccessibleName('The preview reported 2 errors');
    const items = within(popup).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(ERRORS[0].message);
    expect(items[1]).toHaveTextContent(ERRORS[1].message);
  });

  it("names the script by its last path segment and line, not the draft's full URL", () => {
    render(<PreviewErrorsButton diagnostics={diagnosticsOf(ERRORS)} />);

    fireEvent.click(errorsButton());

    const [scriptError, loadError] = within(screen.getByRole('dialog')).getAllByRole('listitem');
    expect(within(scriptError).getByText('index.html:44')).toHaveAttribute('title', ERRORS[0].file);
    // A failed load has no script location; its message already names the URL.
    expect(loadError.textContent).toBe(ERRORS[1].message);
  });

  it('keeps only the line for a srcdoc or data: script, whose URL names nothing', () => {
    render(<PreviewErrorsButton diagnostics={diagnosticsOf([
      { message: 'from srcdoc', file: 'about:srcdoc', line: 12 },
      { message: 'from data', file: 'data:text/javascript;base64,AAA/BBB', line: 0 },
    ])} />);

    fireEvent.click(errorsButton());

    const [srcdoc, data] = within(screen.getByRole('dialog')).getAllByRole('listitem');
    expect(within(srcdoc).getByText('line 12')).toBeInTheDocument();
    expect(data.textContent).toBe('from data');
  });

  it('is a plain popup trigger, not a toggle button', () => {
    render(<PreviewErrorsButton diagnostics={diagnosticsOf(ERRORS)} />);

    expect(errorsButton()).not.toHaveAttribute('aria-pressed');
  });

  it('closes on a press outside it, including one over the preview iframe', () => {
    render(<PreviewErrorsButton diagnostics={diagnosticsOf(ERRORS)} />);
    expect(screen.queryByTestId('preview-errors-outside-dismiss')).toBeNull();

    fireEvent.click(errorsButton());
    // A real press over the iframe hit-tests to this layer, which covers the
    // viewport; it never reaches the iframe's own document.
    fireEvent.mouseDown(screen.getByTestId('preview-errors-outside-dismiss'));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dismisses the whole set with one click', () => {
    const diagnostics = diagnosticsOf(ERRORS);
    render(<PreviewErrorsButton diagnostics={diagnostics} />);

    fireEvent.click(errorsButton());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Dismiss' }));

    expect(diagnostics.dismiss).toHaveBeenCalledTimes(1);
  });

  it('hands focus to the next header control, since Dismiss removes the trigger', () => {
    const diagnostics = diagnosticsOf(ERRORS);
    render(
      <div>
        <PreviewErrorsButton diagnostics={diagnostics} />
        <button type="button">Comments</button>
      </div>,
    );

    fireEvent.click(errorsButton());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Dismiss' }));

    expect(screen.getByRole('button', { name: 'Comments' })).toHaveFocus();
  });

  it('hides the button once the set is dismissed', () => {
    const { rerender } = render(<PreviewErrorsButton diagnostics={diagnosticsOf(ERRORS)} />);
    expect(errorsButton()).not.toBeNull();

    rerender(<PreviewErrorsButton diagnostics={diagnosticsOf(ERRORS, { dismissed: true })} />);

    expect(errorsButton()).toBeNull();
  });

  it('comes back closed when a new set arrives after a dismissal', () => {
    const { rerender } = render(<PreviewErrorsButton diagnostics={diagnosticsOf(ERRORS)} />);
    fireEvent.click(errorsButton());
    rerender(<PreviewErrorsButton diagnostics={diagnosticsOf(ERRORS, { dismissed: true })} />);

    rerender(<PreviewErrorsButton diagnostics={diagnosticsOf([ERRORS[1]])} />);

    // Reopening the list on its own would cover the page the user just
    // repaired; the button alone says something broke again.
    expect(errorsButton()).toHaveAccessibleName('Preview errors, 1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // The banner was role="status", so its error was read out as it appeared.
  // A button alone would drop that; the region keeps it.
  describe('announcement', () => {
    it('is in the page before any error, so the first one is announced', () => {
      const { rerender } = render(<PreviewErrorsButton diagnostics={diagnosticsOf([])} />);
      const region = screen.getByRole('status');
      expect(region).toBeEmptyDOMElement();

      rerender(<PreviewErrorsButton diagnostics={diagnosticsOf([ERRORS[0]])} />);

      expect(screen.getByRole('status')).toBe(region);
      expect(region).toHaveTextContent('The preview reported 1 error');
    });

    it('goes quiet on dismissal', () => {
      render(<PreviewErrorsButton diagnostics={diagnosticsOf(ERRORS, { dismissed: true })} />);

      expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });
  });
});
