import { useRef, useState } from 'react';

const TRANSIENT_KEYS = new Set(['providerStatus', 'providerStatusDetails', 'providerStatusReasons']);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// App owns confirmed settings. This view owns edits, including temporary
// appearance previews. Closing the view discards them without writing to App.
export function useSettingsDraft(committed) {
  const [edits, setEdits] = useState({});
  const editsRef = useRef({});

  const setSetting = (key, value, { autoSave = false } = {}) => {
    const edit = { value, autoSave };
    const next = { ...editsRef.current, [key]: edit };
    editsRef.current = next;
    setEdits(next);
    return edit;
  };

  const capture = () => {
    const entries = Object.fromEntries(Object.entries(editsRef.current).filter(([, edit]) => !edit.autoSave));
    const patch = Object.fromEntries(Object.entries(entries)
      .filter(([key]) => !TRANSIENT_KEYS.has(key))
      .map(([key, edit]) => [key, edit.value]));
    return { entries, patch };
  };

  // A request acknowledges only the exact edits it submitted. New edits made
  // while the request was running survive, even if they restore an old value.
  const acknowledge = (submitted) => {
    const next = { ...editsRef.current };
    const cleared = [];
    for (const [key, edit] of Object.entries(submitted)) {
      if (next[key] === edit) {
        delete next[key];
        cleared.push(key);
      }
    }
    editsRef.current = next;
    setEdits(next);
    return cleared;
  };

  const settings = { ...committed };
  for (const [key, edit] of Object.entries(edits)) settings[key] = edit.value;
  const dirty = Object.entries(edits).some(([key, edit]) => (
    !edit.autoSave && !TRANSIENT_KEYS.has(key) && !equal(edit.value, committed[key])
  ));

  const isCurrent = (key, edit) => editsRef.current[key] === edit;
  return { settings, dirty, setSetting, capture, acknowledge, isCurrent };
}
