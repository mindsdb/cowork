// DocCanvas — one tab of a doc as an editable page.
//
// Each block is its own editable region; the canvas owns what crosses block
// boundaries: Enter splits, Backspace merges, Tab indents, arrows hop, a
// leading "# " or "- " converts, "/" opens the block menu, and a text
// selection raises the formatting bar with "Edit with agent". What each key
// does is decided in canvasOps; every change is a doc op (see docModel /
// cowork-server cowork/docs/ops.py). `onAddTab` adds a
// tab from the page head of a doc of one tab; `nameTitle` and `onNamed`, for
// a tab just added, select its title to be named.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import PageHead from './PageHead';
import TextBlock from './TextBlock';
import BlockGutter, { blockMenuItems } from './BlockGutter';
import ChartBlock from './ChartBlock';
import TableBlock from './TableBlock';
import { CodeBlock, DividerBlock, ImageBlock, MetricsBlock, PendingBlock } from './blocks';
import SlashMenu, { slashOptionId } from './SlashMenu';
import FloatingToolbar from './FloatingToolbar';
import AskAgent from './AskAgent';
import { useCanvasSelection } from './useCanvasSelection';
import { useFocusAfterCommit } from './useFocusAfterCommit';
import { useSlashMenu } from './useSlashMenu';
import { applyInlineFormat, caretOffset, caretOnEdgeLine, caretState, splitAtCaret } from './caret';
import {
  INSERTABLE, backspaceOps, blockLabel, deleteOps, enterOps, formatShortcut, indentOps, insertAboveOps, listNumbers,
  matchShortcut, pasteOps, turnIntoSet,
} from './canvasOps';
import { blockPlainText, isListBlock, isTextBlock, makeBlock } from './docModel';

const NO_ITEMS = [];

export default function DocCanvas({
  doc, tab, editable, apply, flash = {}, agentLive = false, onAskAgent, onSelectionChange,
  onAddTab, nameTitle = false, onNamed,
}) {
  const root = useRef(null);
  const handles = useRef(new Map());
  const refCallbacks = useRef(new Map());
  const slashId = useId();
  const [toolbar, setToolbar] = useCanvasSelection(root, onSelectionChange); // {rect, blockIds, quote, editable, mode, range}
  const [askFor, setAskFor] = useState(null); // {rect, blockIds, quote, mode}
  // Which block's options menu is open; the id outlives the close so the menu
  // keeps its items while it animates out.
  const [menu, setMenu] = useState({ id: null, open: false });
  const focusBlock = useFocusAfterCommit(handles);
  const blocks = tab?.blocks || [];
  const numbers = useMemo(() => listNumbers(blocks), [blocks]);
  const single = doc.tabs.length === 1;

  const run = useCallback((ops) => apply(ops, { tab: tab.id }), [apply, tab?.id]);
  const handle = (id) => handles.current.get(id);
  const blockEl = (id) => root.current?.querySelector(`[data-block-id="${id}"]`);
  /** A canvasOps answer: the editable's text now, then the ops, then the caret. */
  const perform = ({ ops, write, focus }) => {
    if (write) handle(write.id)?.set(write.text);
    // A block these ops delete had its text read into them (a merge): what it
    // still holds must not be committed once it is gone.
    ops.filter((op) => op.op === 'delete').flatMap((op) => op.target).forEach((id) => handle(id)?.discard());
    run(ops);
    if (focus) focusBlock(focus.id, focus.where);
  };
  const turnInto = (b, spec, text) => run([{ op: 'update', id: b.id, set: turnIntoSet(b, spec, text) }]);

  const slashMenu = useSlashMenu({
    canAsk: !!onAskAgent,
    onChoose: (b, item) => {
      if (item.type === 'ask') {
        const h = handle(b.id);
        h?.set('');
        if (b.text) run([{ op: 'update', id: b.id, set: { text: '' } }]);
        setAskFor({ rect: h?.el()?.getBoundingClientRect(), blockIds: [b.id], quote: '', mode: 'write' });
      } else if (INSERTABLE.some((i) => i.type === item.type)) {
        perform(insertAboveOps(b, item.type));
      } else {
        perform({
          ops: [{ op: 'update', id: b.id, set: turnIntoSet(b, item, '') }],
          write: { id: b.id, text: '' },
          focus: { id: b.id, where: 'start' },
        });
      }
    },
  });
  const { slash } = slashMenu;

  // Scrolling the page closes the slash menu and the formatting bar: set up
  // when one opens (or the menu moves to another block), not on every render.
  const slashBlock = slash?.blockId;
  const toolbarOpen = !!toolbar;
  const closeSlash = slashMenu.close;
  useEffect(() => {
    if (!slashBlock && !toolbarOpen) return undefined;
    const scroller = root.current?.closest('.doc-scroll');
    if (!scroller) return undefined;
    const openedAt = Date.now();
    // Focusing a block can scroll it into view; that scroll is not the person's.
    const close = () => {
      if (Date.now() - openedAt < 300) return;
      closeSlash();
      setToolbar((t) => (t && t.mode === 'link' ? t : null));
    };
    scroller.addEventListener('scroll', close, { passive: true });
    return () => scroller.removeEventListener('scroll', close);
  }, [slashBlock, toolbarOpen, closeSlash, setToolbar]);

  // One ref callback per block for the canvas's life: a new one each render
  // had React detach and re-attach every block's handle on every render.
  const register = (id) => {
    if (!refCallbacks.current.has(id)) {
      refCallbacks.current.set(id, (h) => {
        if (h) handles.current.set(id, h);
        else handles.current.delete(id);
      });
    }
    return refCallbacks.current.get(id);
  };
  // A block that goes takes its callback with it: every block the agent
  // rewrites would otherwise leave one behind for the canvas's life.
  useEffect(() => {
    const ids = new Set(blocks.map((b) => b.id));
    for (const id of refCallbacks.current.keys()) if (!ids.has(id)) refCallbacks.current.delete(id);
  }, [blocks]);

  const textBlocks = blocks.filter(isTextBlock);
  const neighborText = (id, dir) => {
    const i = textBlocks.findIndex((b) => b.id === id);
    return textBlocks[i + dir] || null;
  };

  // ── Typing in a text block ──────────────────────────────────────────

  const onKeyDown = (b, i) => (e, api) => {
    const el = api.el;
    if (slashMenu.onKeyDown(e, b)) return;
    const format = formatShortcut(e);
    if (format) {
      e.preventDefault();
      if (format !== 'link') applyInlineFormat(format, el);
      else {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) setToolbar((t) => t && { ...t, mode: 'link' });
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); perform(enterOps(b, splitAtCaret(el))); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      const st = caretState(el);
      const r = e.key === 'Backspace'
        ? st.atStart && backspaceOps(blocks, i, api.read())
        : st.atEnd && deleteOps(blocks, i, api.read());
      if (r) { e.preventDefault(); perform(r); }
      return;
    }
    if (e.key === 'Tab' && isListBlock(b)) {
      e.preventDefault();
      const ops = indentOps(b, e.shiftKey ? -1 : 1, api.read());
      if (ops) run(ops);
      return;
    }
    const hop = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (hop && caretOnEdgeLine(el, hop < 0 ? 'top' : 'bottom')) {
      const to = neighborText(b.id, hop);
      if (to) { e.preventDefault(); api.flush(); handle(to.id)?.focus(hop < 0 ? 'end' : 'start'); }
    }
  };

  const onInput = (b) => (e, api) => {
    const el = api.el;
    const plain = el.textContent || '';
    if (b.type === 'paragraph') {
      if (plain === '---' || plain === '***') { perform(insertAboveOps(b, 'divider')); return; }
      if (plain === '```') { perform(insertAboveOps(b, 'code')); return; }
      const hit = matchShortcut(plain, api.read());
      if (hit && caretOffset(el) === hit.at) {
        slashMenu.close();
        perform({
          ops: [{ op: 'update', id: b.id, set: turnIntoSet(b, hit.spec, hit.text) }],
          write: { id: b.id, text: hit.text },
          focus: { id: b.id, where: 'start' },
        });
        return;
      }
    }
    slashMenu.onInput(b, plain, el);
  };

  const onPaste = (b) => (e, text) => {
    const ops = pasteOps(b, text, !(handle(b.id)?.read() || '').trim());
    if (!ops) return false;
    e.preventDefault();
    run(ops);
    return true;
  };

  const editProps = (b, i) => ({
    ref: register(b.id),
    value: b.text || '',
    editable,
    dataBlock: b.id,
    onCommit: (text) => run([{ op: 'update', id: b.id, set: { text } }]),
    onKeyDown: onKeyDown(b, i),
    onInput: onInput(b),
    onPaste: onPaste(b),
    onBlur: () => setTimeout(() => slashMenu.closeFor(b.id), 120),
    // The menu under the block, and its active item, for a screen reader:
    // the focus stays in the block while the arrows move through the menu.
    aria: slash?.blockId === b.id ? {
      'aria-controls': slashId,
      'aria-activedescendant': slashMenu.items[slash.index] ? slashOptionId(slashId, slash.index) : undefined,
    } : undefined,
  });

  // ── The page ────────────────────────────────────────────────────────

  const askAgent = (request) => {
    const target = askFor;
    setAskFor(null);
    setToolbar(null);
    if (!target || !request.trim()) return;
    onAskAgent?.({ blockIds: target.blockIds, quote: target.quote, request: request.trim(), tabId: tab.id, mode: target.mode });
  };

  const addBelow = (b) => {
    const nb = makeBlock('paragraph');
    run([{ op: 'insert', position: { after: b.id }, blocks: [nb] }]);
    focusBlock(nb.id, 'start', (h) => { const el = h.el(); if (el) slashMenu.openUnder(nb.id, el); });
  };

  const startWriting = () => {
    const last = blocks[blocks.length - 1];
    if (last && last.type === 'paragraph' && !last.text) {
      handle(last.id)?.focus('start');
      return;
    }
    const nb = makeBlock('paragraph');
    run([{ op: 'insert', position: 'end', blocks: [nb] }]);
    focusBlock(nb.id, 'start');
  };

  const title = single ? doc.title : tab.title;
  const commitTitle = (next) => {
    const t = next.trim();
    if (!t) return false; // a doc keeps a name: the old one comes back
    if (t !== title) run([single ? { op: 'rename_doc', title: t } : { op: 'rename_tab', tab: tab.id, title: t }]);
  };

  const renderBlock = (b, i) => {
    if (isTextBlock(b)) {
      return <TextBlock block={b} edit={editProps(b, i)} editable={editable} number={numbers[b.id]} lonely={blocks.length === 1} onOps={run} />;
    }
    switch (b.type) {
      case 'table': return <TableBlock block={b} editable={editable} onOps={run} />;
      case 'chart': return (
        <ChartBlock block={b} tab={tab} editable={editable} onOps={run}
          onShowTable={(id) => blockEl(id)?.scrollIntoView({ block: 'center', behavior: 'smooth' })} />
      );
      case 'metrics': return <MetricsBlock block={b} editable={editable} onOps={run} />;
      case 'code': return <CodeBlock block={b} editable={editable} onOps={run} />;
      case 'image': return <ImageBlock block={b} editable={editable} onOps={run} />;
      case 'divider': return <DividerBlock />;
      case 'pending': return <PendingBlock block={b} live={agentLive} />;
      default: return null;
    }
  };

  const askTargets = new Set(askFor?.blockIds || []);

  return (
    <div className="doc-page" ref={root}>
      <PageHead
        title={title}
        editable={editable}
        onCommit={commitTitle}
        onEnter={() => {
          const first = blocks.find(isTextBlock);
          if (first) handle(first.id)?.focus('start');
          else startWriting();
        }}
        updatedAt={doc.updated_at}
        byAgent={blocks.some((b) => b.by === 'agent')}
        onAddTab={editable && single ? onAddTab : undefined}
        nameNow={editable && nameTitle}
        onNamed={onNamed}
      />

      {blocks.map((b, i) => (
        <div
          key={b.id}
          data-block-id={b.id}
          className={`doc-block doc-block--${b.type} ${flash[b.id] ? 'doc-block--flash' : ''} ${askTargets.has(b.id) ? 'doc-block--selected' : ''}`}
        >
          {editable && (
            <BlockGutter
              label={blockLabel(b)}
              open={menu.open && menu.id === b.id}
              onOpenChange={(o) => setMenu((m) => (o ? { id: b.id, open: true } : m.id === b.id ? { ...m, open: false } : m))}
              onAdd={() => addBelow(b)}
              items={menu.id === b.id ? blockMenuItems({
                blocks,
                index: i,
                onOps: run,
                readText: () => handle(b.id)?.read() ?? b.text,
                turnInto: (spec, text) => turnInto(b, spec, text),
                askAgent: onAskAgent && (() => setAskFor({
                  rect: blockEl(b.id)?.getBoundingClientRect(), blockIds: [b.id], quote: blockPlainText(b).slice(0, 600), mode: 'edit',
                })),
              }) : NO_ITEMS}
            />
          )}
          {renderBlock(b, i)}
        </div>
      ))}

      {editable && (
        <div style={{ minHeight: 120, cursor: 'text' }} onMouseDown={(e) => { e.preventDefault(); startWriting(); }} aria-hidden="true" />
      )}

      {slash && (
        <SlashMenu
          id={slashId}
          items={slashMenu.items}
          query={slash.query}
          index={slash.index}
          // Measured from the block as it stands when placed: a rect kept from
          // the keystroke that opened the menu goes stale once the page reflows.
          rect={() => handle(slash.blockId)?.el()?.getBoundingClientRect() || slash.rect}
          onHover={slashMenu.hover}
          onPick={(it) => { const b = blocks.find((x) => x.id === slash.blockId); if (b) slashMenu.choose(b, it); }}
        />
      )}

      {toolbar && !askFor && toolbar.rect && (
        <FloatingToolbar
          toolbar={toolbar}
          canFormat={editable && !!toolbar.editable}
          canAsk={!!onAskAgent}
          onLinkMode={() => setToolbar({ ...toolbar, mode: 'link' })}
          onClose={() => setToolbar(null)}
          onAsk={() => setAskFor({ rect: toolbar.rect, blockIds: toolbar.blockIds, quote: toolbar.quote, mode: 'edit' })}
        />
      )}

      {askFor && <AskAgent target={askFor} onSubmit={askAgent} onCancel={() => setAskFor(null)} />}
    </div>
  );
}
