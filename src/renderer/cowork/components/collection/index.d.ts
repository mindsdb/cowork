import type { ReactNode, RefObject } from 'react';

export function PageHeader(props: {
  title?: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  subtitleBottom?: number;
  crumbs?: { key?: string; label: ReactNode; onClick?: () => void; title?: string; maxWidth?: number }[];
  current?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  actions?: ReactNode;
}): ReactNode;

export function FilterRow(props: { search?: ReactNode; filter?: ReactNode; sort?: ReactNode; view?: ReactNode; counts?: ReactNode; right?: ReactNode; chips?: ReactNode }): ReactNode;

export function SearchInput(props: {
  value: string;
  onChange: (value: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  placeholder?: string;
  ariaLabel?: string;
  shortcut?: string;
}): ReactNode;

export function SortPill(props: {
  value: string;
  onChange: (id: string) => void;
  options: { id: string; label: string }[];
  label?: string;
}): ReactNode;

export function useCollectionShortcut(searchRef: RefObject<HTMLInputElement | null>, enabled?: boolean): void;
export { CardGrid, ItemCard } from './ItemCard';
export { ListGroup, ListItem, NewRow, ListNotice } from './ListGroup';
export type { ListDensity } from './ListGroup';
export { HoverActions, REVEAL_ON_HOVER } from './itemParts';
export type { ItemSlots } from './itemParts';
export { StatusDot } from './StatusDot';
export type { StatusTone } from './StatusDot';

export { CollectionState } from './CollectionState';
export { ViewToggle, useCollectionView } from './ViewToggle';
export { NewTile } from './NewTile';
export { FilterMenu, FilterChips } from './FilterMenu';
export type { Filter, FilterOption } from './FilterMenu';
