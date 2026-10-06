// Collection kit — shared primitives for list/grid pages
// (Projects, Live Artifacts, Connect Apps and Data, Scheduled tasks).
// See README.md for which piece goes where.
//
// Composition rather than a single shell — each view stays in control
// of its own body and detail mode while sharing the
// page-header rhythm, the search/sort/view controls, the body states
// (loading / empty / no-match), the trailing new tile, and the ⌘K
// shortcut wiring. Three tokens that drift the most across views
// (input border radius, sort menu shadow, segmented-control padding)
// now live here once.

export { PageHeader }           from './PageHeader';
export { FilterRow }            from './FilterRow';
export { SearchInput }          from './SearchInput';
export { SortPill }             from './SortPill';
export { HoverMenu }            from './HoverMenu';
export { useCollectionShortcut } from './useCollectionShortcut';
export { CardGrid, ItemCard }   from './ItemCard';
export { ListGroup, ListItem, NewRow, ListNotice } from './ListGroup';
export { HoverActions, REVEAL_ON_HOVER } from './itemParts';
export { StatusDot }            from './StatusDot';
export { CollectionState }      from './CollectionState';
export { ViewToggle, useCollectionView } from './ViewToggle';
export { NewTile }              from './NewTile';
export { FilterMenu, FilterChips } from './FilterMenu';
