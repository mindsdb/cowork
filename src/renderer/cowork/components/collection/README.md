# Collection kit

Shared pieces for index pages: Projects, Artifacts, Scheduled, Tasks, Skills,
Connectors, and their Code Mode counterparts. Pages compose these pieces; no
single shell owns a page.

## Which piece goes where

| Part of the page | Use |
|---|---|
| Header | `PageHeader` |
| Toolbar | `FilterRow`. Left changes what's shown: `SearchInput`, then one `FilterMenu` holding every facet, with its `FilterChips` in `chips`. Right changes how it's shown: `SortPill` (a quiet control), then `ViewToggle`. A page with no facets has no Filter. |
| Count | `FilterRow`'s `counts`: the list's caption, "3 tasks" or "1 of 3 tasks" when filtered. |
| ⌘K focuses search | `useCollectionShortcut(searchRef)` |
| Grid or list preference | `useCollectionView(storageKey, { defaultView })`. It stores an explicit choice and gives phones the page default. |
| Loading, empty, no match | `CollectionState` wraps the body |
| Cards | `CardGrid` › `ItemCard` … `NewTile` |
| Rows | `ListGroup` › `ListItem` … `NewRow`, plus `ListNotice` for an inline line |
| Item controls | `HoverActions` (a kebab: `<OverflowMenu size="sm">`) |
| Status in meta | `StatusDot` |

## Choosing cards or rows

Lists are the default. Projects, Artifacts, and Connected Apps open as cards
and offer a grid/list toggle; every other page is list-only. A task looks the
same everywhere: use `TaskRow` from `components/task`.

## Item slots

`ItemCard` and `ListItem` take the same slots, so a page builds an item once
and renders it either way.

```tsx
const slots = {
  leading: <Logo />,
  title: 'Gmail',
  badges: <Badge>Built-in</Badge>,
  description: 'work@example.com',
  meta: <StatusDot tone="success">Connected</StatusDot>,
  actions: <OverflowMenu size="sm" items={…} />,
  onActivate: () => open(conn),
  activateLabel: 'Manage Gmail: work@example.com',
};
view === 'grid' ? <ItemCard as="article" {...slots} /> : <ListItem as="article" {...slots} />;
```

- **Opening.** `onActivate` wraps the title in a real `<button>` whose
  `::after` covers the whole item, so the item can stay a `div`, `article` or
  `li` and still nest its own buttons. The button takes its name from the
  title, or from `activateLabel` when set. Omit `onActivate` while the title
  holds an input, such as an inline rename.
- **Actions.** `actions` are hidden at rest. They appear on hover, when focus
  is inside the item, while their menu is open, and always on touch devices
  (no hover, or a coarse pointer). They stay in the tab order, so Tab from
  the title reaches them. Hover-revealed actions overlay the end of the title
  (card) or meta (row); `revealActions` keeps them visible and in flow, so they
  never cover the title, an inline rename, or the meta. To show a control at
  rest, such as Connectors' labelled Disconnect, put it in `meta` inside
  `<HoverActions reveal>`. That also lifts it above the item's click area,
  and from `sm` up a row then gives `actions` their own space instead of
  overlaying the meta.
- **`busy`** dims the item, sets `aria-busy`, and disables opening.
- **`selected`** gives cards an accent border and rows a firmer fill.

## Spacing

Every list uses one row padding, `px-4 py-2.5`, with no minimum height, so a
row's height follows its content: a one-line task stays compact, and a row
with a description gets a second line. Rows, `NewRow`, and `ListNotice` share
it. Don't add per-page or per-mode spacing.

`ListGroup` takes an optional header (`title`, `description`, `meta`,
`actions`) for grouped lists, such as Code Mode connectors grouped by provider
with a Connect button per provider.

## Layout

Kit parts carry no page padding. Pass it with `className`, matching the
page's toolbar, such as `className="px-8 pt-5 pb-14"` on `CardGrid` or
`className="mx-8 mt-5 mb-14"` on `ListGroup`.
