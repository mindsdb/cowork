import { Lightbulb } from 'lucide-react';
import { Icon } from '../components/ui/Icon';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import Menu from '../components/ui/Menu';

export function ComposerAddMenu({ disabled, onAttach, planMode = false, onPlanChange, planDisabled = false }: {
  disabled: boolean;
  onAttach: () => void;
  planMode?: boolean;
  onPlanChange?: (enabled: boolean) => void;
  planDisabled?: boolean;
}) {
  return <>
    <Menu
      ariaLabel="Add"
      side="top"
      align="start"
      width={290}
      trigger={<Button icon variant="subtle" size="sm" disabled={disabled} aria-label="Add to prompt">{Ico.plus(16)}</Button>}
      items={[
        { id: 'heading', heading: <span className="text-[11px] font-semibold text-ink-3">Add</span> },
        ...(onPlanChange ? [{
          id: 'plan',
          icon: <Icon of={Lightbulb} size={14} />,
          label: 'Plan mode',
          hint: planMode ? Ico.check(12) : undefined,
          disabled: disabled || planDisabled,
          title: planDisabled ? 'Available after the current turn finishes' : undefined,
          onClick: () => onPlanChange(!planMode),
        }] : []),
        { id: 'files', icon: Ico.attach(14), label: 'Files and folders', disabled, onClick: onAttach },
      ]}
    />
    {planMode && <Button
      variant="tinted" size="sm" disabled={disabled || planDisabled || !onPlanChange}
      className="code-plan-indicator" aria-label="Turn plan mode off" onClick={() => onPlanChange?.(false)}
    ><Icon of={Lightbulb} size={14} /> Plan {Ico.close(12)}</Button>}
  </>;
}
