# `components/ui` — shared UI primitives

Cowork's low-level UI building blocks. Import from the barrel — `index.js` is the
canonical list of what's exported:

```js
import { Button, Input, Textarea, Menu } from '../components/ui';
```

(A few primitives live outside the barrel and are imported by path — e.g.
`import { Modal, ModalHeader, ModalBody, ModalFooter } from './ui/Modal'`.)

Each primitive wraps [Base UI](https://base-ui.com) (unstyled, accessible behaviour)
and paints it with the existing `.btn` / `.field-*` CSS class systems, so the rendered
markup and look match the hand-rolled originals it replaced (the ENG-639 migration).

**Convention: prefer these primitives over raw `<button className="btn-*">` /
`<input className="field-input">` markup.** One implementation means accessibility,
theming, and behaviour get fixed in one place instead of per call-site.

- `<Button variant="primary|subtle|tinted|solid|danger" size icon block>` — forwards its ref,
  so it can also back a `<Menu trigger={<Button/>}>` or render polymorphically via `render`.
- `<Input>` / `<Textarea>`, `<Modal>` (+ `ModalHeader/Body/Footer`), `<Menu>` — see each
  file's header comment for the full prop list and usage examples.

The bespoke button systems (`channels-btn`, `dispatch-btn`, `customize-*btn`, `icon-btn`)
are intentionally **not** part of this set — they carry their own design languages and
were left as-is during the migration.
