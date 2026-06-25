// Collection kit — shared primitives for list/grid pages
// (Projects, Live Artifacts, Connect Apps and Data, Scheduled tasks).
//
// Composition rather than a single shell — each view stays in control
// of its own body, empty-state, and detail mode while sharing the
// page-header rhythm, the search/sort/view controls, and the ⌘K
// shortcut wiring. Three tokens that drift the most across views
// (input border radius, sort menu shadow, segmented-control padding)
// now live here once.

export { PageHeader }           from './PageHeader';
export { FilterRow }            from './FilterRow';
export { SearchInput }          from './SearchInput';
export { SortPill }             from './SortPill';
export { HoverMenu }            from './HoverMenu';
export { useCollectionShortcut } from './useCollectionShortcut';
