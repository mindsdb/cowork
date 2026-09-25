import { Lightbulb } from 'lucide-react';
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
      trigger={<Button icon variant="subtle" size="sm" disabled={disabled} aria-label="Add to prompt" title="Add">{Ico.plus(16)}</Button>}
      items={[
        { id: 'heading', heading: <span className="text-[11px] font-semibold text-ink-3">Add</span> },
        ...(onPlanChange ? [{
          id: 'plan',
          icon: <Lightbulb size={15} strokeWidth={1.5} aria-hidden="true" />,
          label: 'Plan mode',
          hint: <span className="font-body text-[12px]">Turn plan mode {planMode ? 'off' : 'on'}</span>,
          disabled: disabled || planDisabled,
          title: planDisabled ? 'Available after the current turn finishes' : undefined,
          onClick: () => onPlanChange(!planMode),
        }] : []),
        { id: 'files', icon: Ico.attach(15), label: 'Files and folders', disabled, onClick: onAttach },
      ]}
    />
    {planMode && <Button
      variant="tinted" size="sm" disabled={disabled || planDisabled || !onPlanChange}
      className="code-plan-indicator" aria-label="Turn plan mode off" onClick={() => onPlanChange?.(false)}
    ><Lightbulb size={13} strokeWidth={1.5} aria-hidden="true" /> Plan {Ico.close(10)}</Button>}
  </>;
}
