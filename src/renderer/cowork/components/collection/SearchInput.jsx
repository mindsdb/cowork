// Search input for collection toolbars: `<Input>` with a leading magnifier and
// a trailing shortcut hint (⌘K by default; pass "" or null to hide it, e.g.
// when the page doesn't wire `useCollectionShortcut`). Width flexes within
// FilterRow's flex container; pass a custom `placeholder` per view.

import Ico from '../Icons';
import { Input, Kbd } from '../ui';
import { useTranslation } from '../../../lib/i18n';

export function SearchInput({
  value,
  onChange,
  inputRef,
  placeholder: placeholderProp,
  ariaLabel: ariaLabelProp,
  shortcut = '⌘K',
}) {
  const { t } = useTranslation('library');
  const placeholder = placeholderProp ?? t('collection.search');
  const ariaLabel = ariaLabelProp ?? placeholder;
  return (
    <Input
      ref={inputRef}
      type="text"
      aria-label={ariaLabel}
      value={value || ''}
      onChange={(next) => onChange?.(next)}
      placeholder={placeholder}
      leading={Ico.search(14)}
      trailing={shortcut && <Kbd>{shortcut}</Kbd>}
      wrapperClassName="flex-[0_1_320px] min-w-[220px]"
    />
  );
}
