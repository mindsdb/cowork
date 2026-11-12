import { Lightbulb } from 'lucide-react';
import { Icon } from '../components/ui/Icon';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import Menu from '../components/ui/Menu';
import { useTranslation } from '../../lib/i18n';

export function ComposerAddMenu({ disabled, onAttach, planMode = false, onPlanChange, planDisabled = false }: {
  disabled: boolean;
  onAttach: () => void;
  planMode?: boolean;
  onPlanChange?: (enabled: boolean) => void;
  planDisabled?: boolean;
}) {
  const { t } = useTranslation('code');
  return <>
    <Menu
      ariaLabel={t('composerAddMenu.ariaLabel')}
      side="top"
      align="start"
      width={290}
      trigger={<Button icon variant="subtle" size="sm" disabled={disabled} aria-label={t('composerAddMenu.triggerAriaLabel')}>{Ico.plus(16)}</Button>}
      items={[
        { id: 'heading', heading: <span className="text-[11px] font-semibold text-ink-3">{t('composerAddMenu.heading')}</span> },
        ...(onPlanChange ? [{
          id: 'plan',
          icon: <Icon of={Lightbulb} size={14} />,
          label: t('composerAddMenu.planMode'),
          hint: planMode ? Ico.check(12) : undefined,
          disabled: disabled || planDisabled,
          title: planDisabled ? t('composerAddMenu.planUnavailable') : undefined,
          onClick: () => onPlanChange(!planMode),
        }] : []),
        { id: 'files', icon: Ico.attach(14), label: t('composerAddMenu.files'), disabled, onClick: onAttach },
      ]}
    />
    {planMode && <Button
      variant="tinted" size="sm" disabled={disabled || planDisabled || !onPlanChange}
      className="code-plan-indicator" aria-label={t('composerAddMenu.planOffAriaLabel')} onClick={() => onPlanChange?.(false)}
    ><Icon of={Lightbulb} size={14} /> {t('composerAddMenu.plan')} {Ico.close(12)}</Button>}
  </>;
}
