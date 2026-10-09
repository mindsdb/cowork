// Grid/list view switch for collection pages, plus the hook that owns the
// choice. The choice persists per page under the page's own localStorage key.
// Each page names its default: cards for places you work in (Projects,
// Artifacts), rows for things you manage (Scheduled, Skills). Phones always get
// the page default and the toggle is not drawn there; the stored desktop choice
// is left as it was.
//
//   const { view, setView, effectiveView } = useCollectionView('anton:artifacts-view');
//   <FilterRow view={<ViewToggle value={view} onValueChange={setView} />} … />
//   {effectiveView === 'grid' ? grid : list}

import { useCallback, useState } from 'react';
import Ico from '../Icons';
import { ToggleGroup } from '../ui/ToggleGroup';
import { useBreakpoint } from '../../hooks/useBreakpoint';

export type CollectionViewMode = 'grid' | 'list';

function readView(storageKey: string, fallback: CollectionViewMode): CollectionViewMode {
  try {
    const stored = localStorage.getItem(storageKey);
    return stored === 'list' || stored === 'grid' ? stored : fallback;
  } catch {
    return fallback;
  }
}

export interface CollectionViewOptions {
  /** First-visit layout, and the layout phones always get. */
  defaultView?: CollectionViewMode;
}

export function useCollectionView(storageKey: string, { defaultView = 'grid' }: CollectionViewOptions = {}) {
  const { isMobile } = useBreakpoint();
  const [view, setViewState] = useState<CollectionViewMode>(() => readView(storageKey, defaultView));
  // Only an explicit choice is stored, so a visitor who never picks keeps
  // following the page default.
  const setView = useCallback((next: CollectionViewMode) => {
    setViewState(next);
    try { localStorage.setItem(storageKey, next); } catch { /* storage unavailable */ }
  }, [storageKey]);
  const effectiveView: CollectionViewMode = isMobile ? defaultView : view;
  return { view, setView, effectiveView, isMobile };
}

const OPTIONS = [
  { value: 'grid', label: 'Grid', icon: Ico.grid(14) },
  { value: 'list', label: 'List', icon: Ico.list(14) },
];

export interface ViewToggleProps {
  value: CollectionViewMode;
  onValueChange: (value: CollectionViewMode) => void;
}

export function ViewToggle({ value, onValueChange }: ViewToggleProps) {
  const { isMobile } = useBreakpoint();
  if (isMobile) return null;
  return (
    <ToggleGroup
      value={value}
      onValueChange={(next) => onValueChange(next as CollectionViewMode)}
      size="md"
      aria-label="View"
      options={OPTIONS}
    />
  );
}

export default ViewToggle;
