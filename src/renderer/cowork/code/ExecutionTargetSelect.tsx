import { Cloud, Monitor } from 'lucide-react';

import Select from '../components/ui/Select';
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
  unavailableReason = 'Unavailable',
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
  const available = availableComputerIds ? new Set(availableComputerIds) : null;
  const local = computers.find(isThisComputer);
  const remotes = computers.filter((computer) => !isThisComputer(computer));
  const computerOptions = [
    ...(local ? [{
      value: local.id,
      label: 'This computer',
      triggerLabel: 'This computer',
      description: `${platformLabel(local.capabilities.platform)} · Ready now`,
      icon: <Monitor size={13} strokeWidth={1.5} aria-hidden="true" />,
    }] : []),
    ...remotes.map((computer) => ({
      value: computer.id,
      label: computer.name,
      triggerLabel: computer.name,
      description: `${platformLabel(computer.capabilities.platform)} · ${computer.status !== 'online'
        ? 'Offline'
        : computer.active_run_count
          ? `${computer.active_run_count} active ${computer.active_run_count === 1 ? 'task' : 'tasks'}`
          : 'Ready'}`,
      icon: <Monitor size={13} strokeWidth={1.5} aria-hidden="true" />,
      disabled: localOnly || computer.status !== 'online' || Boolean(available && !available.has(computer.id)),
      meta: computer.status !== 'online'
        ? undefined
        : localOnly
          ? 'Local folder'
          : (available && !available.has(computer.id)) ? unavailableReason : undefined,
    })),
  ];

  return (
    <Select
      value={computerId || local?.id || ''}
      onValueChange={onComputerChange}
      options={[
        { group: 'Computers', options: computerOptions },
        { separator: true },
        {
          value: '__mindshub_cloud__',
          label: 'MindsHub Cloud',
          triggerLabel: 'MindsHub Cloud',
          description: 'Managed, on-demand compute',
          icon: <Cloud size={13} strokeWidth={1.5} aria-hidden="true" />,
          meta: 'Coming soon',
          disabled: true,
        },
      ]}
      variant="unstyled"
      ariaLabel="Run task on"
      menuLabel="Run task on"
      onOpenChange={(open) => { if (open) onOpen?.(); }}
      placeholder="This computer"
      disabled={disabled || !computerOptions.length}
      loading={loading}
      className="meta-pill code-composer-picker code-computer-picker"
      menuMinWidth={280}
    />
  );
}
