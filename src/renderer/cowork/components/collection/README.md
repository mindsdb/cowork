# Collection kit

Shared pieces for index pages: Projects, Artifacts, Scheduled, Tasks, Skills,
Connectors, and their Code Mode counterparts. Pages compose these pieces; no
single shell owns a page.

## Which piece goes where

| Part of the page | Use |
|---|---|
| Header | `PageHeader` |
| Toolbar | `FilterRow`. Search is `SearchInput`, filters and sort are `Select variant="pill"` (or `SortPill`), and the view switch is `ViewToggle`. |
| ⌘K focuses search | `useCollectionShortcut(searchRef)` |
| Grid or list preference | `useCollectionView(storageKey, { defaultView })`. It stores an explicit choice and gives phones the page default. |
| Loading, empty, no match | `CollectionState` wraps the body |
| Cards | `CardGrid` › `ItemCard` … `NewTile` |
| Rows | `ListGroup` › `ListItem` … `NewRow`, plus `ListNotice` for an inline line |
| Item controls | `HoverActions` (a kebab menu using `ITEM_MENU_TRIGGER`) |
| Status in meta | `StatusDot` |

## Choosing cards or rows

Things you manage are rows: Scheduled, Connectors, Skills, Tasks. Places you
work in and things you open are cards: Projects, Artifacts. Keep a page's
grid/list toggle where it already exists, so saved preferences still work.

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
  actions: <OverflowMenu triggerClassName={ITEM_MENU_TRIGGER} items={…} />,
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
  is inside the item, while their menu is open, and always on touch devices.
  They stay in the tab order, so Tab from the title reaches them. To show a
  control at rest, such as Connectors' labelled Disconnect, put it in `meta`
  inside `<HoverActions reveal>`. That also lifts it above the item's
  click area.
- **`busy`** dims the item, sets `aria-busy`, and disables opening.
- **`selected`** gives cards an accent border and rows a firmer fill.

## Density

Set `density` once on `ListGroup`. Its rows, `NewRow`, and `ListNotice` read
it, and a row can override it.

- `comfortable` (default) is the Cowork page rhythm: 60px minimum rows,
  `px-4 py-3`.
- `compact` is Code Mode's rhythm: `px-3 py-2.5`, no minimum height.

`ListGroup` takes an optional header (`title`, `description`, `meta`,
`actions`) for grouped lists, such as Code Mode connectors grouped by provider
with a Connect button per provider.

## Layout

Kit parts carry no page padding. Pass it with `className`, matching the
page's toolbar, such as `className="px-8 pt-5 pb-14"` on `CardGrid` or
`className="mx-8 mt-5 mb-14"` on `ListGroup`.
