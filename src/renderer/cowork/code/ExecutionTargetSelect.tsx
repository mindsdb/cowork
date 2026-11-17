import { Cloud, Monitor } from 'lucide-react';
import { Icon } from '../components/ui/Icon';

import Select from '../components/ui/Select';
import { useTranslation } from '../../lib/i18n';
import type { CodeComputer } from './api';


function platformLabel(platform: CodeComputer['capabilities']['platform']): string {
  if (platform === 'darwin') return 'macOS';
  if (platform === 'windows') return 'Windows';
  return 'Linux';
}


function isThisComputer(computer: CodeComputer): boolean {
  return computer.is_local || computer.id === 'local' || computer.name === 'This computer';
}


export function ExecutionTargetSelect({
  computers,
  computerId,
  onComputerChange,
  disabled,
  loading,
  localOnly = false,
  availableComputerIds,
  unavailableReason,
  onOpen,
}: {
  computers: CodeComputer[];
  computerId: string;
  onComputerChange: (id: string) => void;
  disabled?: boolean;
  loading?: boolean;
  localOnly?: boolean;
  availableComputerIds?: string[];
  unavailableReason?: string;
  onOpen?: () => void;
}) {
  const { t } = useTranslation('code');
  const available = availableComputerIds ? new Set(availableComputerIds) : null;
  const local = computers.find(isThisComputer);
  const remotes = computers.filter((computer) => !isThisComputer(computer));
  const computerOptions = [
    ...(local ? [{
      value: local.id,
      label: t('executionTarget.thisComputer'),
      triggerLabel: t('executionTarget.thisComputer'),
      description: t('executionTarget.readyNow', { platform: platformLabel(local.capabilities.platform) }),
      icon: <Icon of={Monitor} size={14} />,
    }] : []),
    ...remotes.map((computer) => ({
      value: computer.id,
      label: computer.name,
      triggerLabel: computer.name,
      description: computer.status !== 'online'
        ? t('executionTarget.offline', { platform: platformLabel(computer.capabilities.platform) })
        : computer.active_run_count
          ? t('executionTarget.activeTasks', { platform: platformLabel(computer.capabilities.platform), count: computer.active_run_count })
          : t('executionTarget.ready', { platform: platformLabel(computer.capabilities.platform) }),
      icon: <Icon of={Monitor} size={14} />,
      disabled: localOnly || computer.status !== 'online' || Boolean(available && !available.has(computer.id)),
      meta: computer.status !== 'online'
        ? undefined
        : localOnly
          ? t('executionTarget.localFolder')
          : (available && !available.has(computer.id)) ? unavailableReason ?? t('executionTarget.unavailable') : undefined,
    })),
  ];

  return (
    <Select
      value={computerId || local?.id || ''}
      onValueChange={onComputerChange}
      options={[
        { group: t('executionTarget.computers'), options: computerOptions },
        { separator: true },
        {
          value: '__mindshub_cloud__',
          label: 'MindsHub Cloud',
          triggerLabel: 'MindsHub Cloud',
          description: t('executionTarget.cloudDescription'),
          icon: <Icon of={Cloud} size={14} />,
          meta: t('executionTarget.comingSoon'),
          disabled: true,
        },
      ]}
      variant="unstyled"
      ariaLabel={t('executionTarget.runOn')}
      menuLabel={t('executionTarget.runOn')}
      onOpenChange={(open) => { if (open) onOpen?.(); }}
      placeholder={t('executionTarget.thisComputer')}
      disabled={disabled || !computerOptions.length}
      loading={loading}
      className="meta-pill code-composer-picker code-computer-picker"
      menuMinWidth={280}
    />
  );
}
