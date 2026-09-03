import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { resetDocumentVisibility, setDocumentVisibility } from '../../../../tests/helpers/visibility';

const windowSignal = vi.hoisted(() => ({ send: null as ((visible: boolean) => void) | null }));

vi.mock('../../platform/host', () => ({
  host: {
    onWindowVisibility: (cb: (visible: boolean) => void) => { windowSignal.send = cb; return () => {}; },
  },
}));

import { useAppVisible } from './useAppVisible';


afterEach(() => {
  act(() => windowSignal.send?.(true));
  resetDocumentVisibility();
});


it('flips on the main window hide and show signal while the document still reads visible', () => {
  const { result } = renderHook(() => useAppVisible());
  expect(result.current).toBe(true);

  act(() => windowSignal.send!(false));

  expect(document.visibilityState).toBe('visible');
  expect(result.current).toBe(false);

  act(() => windowSignal.send!(true));
  expect(result.current).toBe(true);
});


it('stays hidden while the document itself is hidden', () => {
  const { result } = renderHook(() => useAppVisible());

  act(() => setDocumentVisibility('hidden'));
  expect(result.current).toBe(false);

  act(() => setDocumentVisibility('visible'));
  expect(result.current).toBe(true);
});
