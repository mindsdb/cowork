// Grid/list view switch for collection pages, plus the hook that owns the
// choice. The choice persists per page under the page's own localStorage key.
// List rows are multi-column and break at phone widths, so phones always get
// the grid and the toggle is not drawn there; the stored desktop choice is
// left as it was.
//
//   const { view, setView, effectiveView } = useCollectionView('anton:projects-view');
//   <FilterRow view={<ViewToggle value={view} onValueChange={setView} />} … />
//   {effectiveView === 'grid' ? grid : list}

import { useEffect, useState } from 'react';
import Ico from '../Icons';
import { ToggleGroup } from '../ui/ToggleGroup';
import { useBreakpoint } from '../../hooks/useBreakpoint';

export type CollectionViewMode = 'grid' | 'list';

function readView(storageKey: string): CollectionViewMode {
  try {
    return localStorage.getItem(storageKey) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export function useCollectionView(storageKey: string) {
  const { isMobile } = useBreakpoint();
  const [view, setView] = useState<CollectionViewMode>(() => readView(storageKey));
  useEffect(() => {
    try { localStorage.setItem(storageKey, view); } catch { /* storage unavailable */ }
  }, [storageKey, view]);
  const effectiveView: CollectionViewMode = isMobile ? 'grid' : view;
  return { view, setView, effectiveView, isMobile };
}

const OPTIONS = [
  { value: 'grid', label: 'Grid', icon: Ico.grid(13) },
  { value: 'list', label: 'List', icon: Ico.list(13) },
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
