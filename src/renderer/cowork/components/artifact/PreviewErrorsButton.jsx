// Errors the previewed page reported about itself, as a `[!]` button in the
// viewer header (ENG-3002). It replaced a banner above the preview that cost
// height permanently, showed one message out of N and ended in a "(+N more)"
// that led nowhere; the button costs no layout and opens the whole list.

import { useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import Ico from '../Icons';
import { Button, OutsidePressLayer, Tooltip } from '../ui';
import { IconButton } from './ArtifactViewerIconButton';

const errorCount = (n) => `${n} ${n === 1 ? 'error' : 'errors'}`;

// Where an error came from, short enough for one line: the shim reports the
// script's full URL, and only its last segment tells the user anything. A
// srcdoc preview (org mode) reports "about:srcdoc", and data:/blob: URLs have
// no meaningful segment, so those keep only the line.
function errorLocation({ file, line }) {
  if (!file) return '';
  if (/^(about|data|blob):/i.test(file)) return line ? `line ${line}` : '';
  const name = file.split(/[?#]/)[0].split('/').filter(Boolean).pop() || file;
  return line ? `${name}:${line}` : name;
}

// The control after `el` in document order among its container's buttons,
// or the one before it when `el` is last.
function neighbourButton(el) {
  const buttons = [...(el?.parentElement?.querySelectorAll('button:not([disabled])') || [])]
    .filter((b) => b !== el);
  return buttons.find((b) => el.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    || buttons[buttons.length - 1]
    || null;
}

// The trigger and the list behind it. Mounted only while there is an
// undismissed error, so the open state starts closed every time the set
// comes back instead of reopening the popover on its own.
function PreviewErrorsPopover({ errors, onDismiss }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  // Dismissing unmounts the trigger, so Base UI has nowhere to return focus
  // and a keyboard user would land on <body>. Hand it to the next header
  // control first.
  const dismiss = () => {
    neighbourButton(triggerRef.current)?.focus();
    onDismiss();
  };
  return (
    <>
      {/* Clicks inside the preview iframe never reach Base UI's
          parent-document listener. See OutsidePressLayer. */}
      {open && (
        <OutsidePressLayer
          data-testid="preview-errors-outside-dismiss"
          onPress={() => setOpen(false)}
          zIndex={89}
        />
      )}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Tooltip content="Preview errors">
          <Popover.Trigger
            className="data-[popup-open]:!bg-surface-2"
            render={(
              <IconButton ref={triggerRef} aria-label={`Preview errors, ${errors.length}`}>
                {/* The glyph carries its own color: IconButton's hover
                    handlers rewrite the button's, which would turn it grey. */}
                <span className="inline-flex text-danger">{Ico.warning(17)}</span>
              </IconButton>
            )}
          />
        </Tooltip>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={8} style={{ zIndex: 90 }}>
            <Popover.Popup
              className="bg-surface rounded-[14px] shadow-sh-popup overflow-hidden outline-none font-body"
              style={{ width: 'min(400px, 92vw)' }}
            >
              <Popover.Title className="s-h3 m-0 py-3 px-4 border-b border-t-0 border-x-0 border-solid border-line">
                {`The preview reported ${errorCount(errors.length)}`}
              </Popover.Title>
              <ul className="list-none m-0 py-2 px-4 max-h-[280px] overflow-y-auto">
                {/* Rows hold no state, so an index key is safe even though
                    the hook can replace an entry in place (a policy report
                    folding into a failed load). */}
                {errors.map((error, index) => {
                  const where = errorLocation(error);
                  return (
                    <li
                      key={index}
                      className="py-[6px] border-b border-t-0 border-x-0 border-solid border-line last:border-b-0"
                    >
                      <span className="block text-[12.5px] leading-[1.45] text-danger [overflow-wrap:anywhere]">
                        {error.message}
                      </span>
                      {where && (
                        <span className="block mt-px font-[family-name:var(--font-mono)] text-[11.5px] text-ink-3" title={error.file}>
                          {where}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="flex justify-end py-3 px-4 border-t border-b-0 border-x-0 border-solid border-line">
                {/* One dismissal for the whole set. It holds for this set only:
                    a different error brings the button back, because after a
                    repair a page often breaks in a new way. */}
                <Button size="sm" onClick={dismiss}>Dismiss</Button>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}

// `diagnostics` is `{ errors, dismissed, dismiss }` from usePreviewDiagnostics.
//
// The live region is rendered whether or not there is anything to report:
// a region inserted together with its text is not reliably announced, and
// the banner this replaced was announced as soon as the first error landed.
export function PreviewErrorsButton({ diagnostics }) {
  const visible = diagnostics.errors.length > 0 && !diagnostics.dismissed;
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {visible ? `The preview reported ${errorCount(diagnostics.errors.length)}` : ''}
      </span>
      {visible && (
        <PreviewErrorsPopover errors={diagnostics.errors} onDismiss={diagnostics.dismiss} />
      )}
    </>
  );
}

export default PreviewErrorsButton;
