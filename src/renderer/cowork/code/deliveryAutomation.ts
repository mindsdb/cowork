import type {
  DeliveryAutomationPolicy,
  DeliveryPlan,
  DeliveryPlanItem,
  DeliveryRecord,
  PullRequestCheck,
  SourceContext,
} from './api';

export type DeliveryAutomationAction =
  | { kind: 'fix'; key: string; fingerprint: string; item: DeliveryPlanItem; check: PullRequestCheck }
  | { kind: 'ready' | 'merge'; key: string; item: DeliveryPlanItem }
  | { kind: 'complete'; key: string; context: SourceContext }
  | { kind: 'archive'; key: string };

export function deliveryFixCheckPrompt(item: DeliveryPlanItem, check: PullRequestCheck): string {
  const evidence = [
    check.detail,
    ...(check.annotations || []).map((annotation) => (
      `${annotation.path}${annotation.start_line ? `:${annotation.start_line}` : ''}: ${annotation.title || annotation.message}`
    )),
  ].filter(Boolean).join('\n');
  return `Fix the failing GitHub check “${check.name}” on ${item.external_url}. Use the failure evidence below, reproduce it locally where possible, make the smallest correct change in this isolated task workspace, and rerun the relevant verification. Do not publish or merge anything.${evidence ? `\n\nFailure evidence:\n${evidence}` : ''}`;
}

function hasPublishedDelivery(
  deliveries: DeliveryRecord[],
  context: SourceContext,
  action: DeliveryRecord['action'],
): boolean {
  return deliveries.some((delivery) => (
    delivery.target_url === context.url
    && delivery.action === action
    && delivery.status === 'published'
  ));
}

export function nextDeliveryAutomationAction({
  sessionId,
  plan,
  policy,
  sourceContexts,
  deliveries,
}: {
  sessionId: string;
  plan: DeliveryPlan;
  policy: DeliveryAutomationPolicy;
  sourceContexts: SourceContext[];
  deliveries: DeliveryRecord[];
}): DeliveryAutomationAction | null {
  const publishedItems = plan.items.filter((item) => item.status === 'published' && item.pull_request_status);
  for (const item of publishedItems) {
    const status = item.pull_request_status!;
    const failing = status.checks?.find((check) => check.state === 'failing');
    if (policy.fix_failing_checks && failing) {
      const fingerprint = `${item.external_url}:${status.updated_at || ''}:${failing.id || failing.name}`;
      return { kind: 'fix', key: `fix:${fingerprint}`, fingerprint, item, check: failing };
    }
    if (policy.mark_ready_when_passing && status.state === 'draft' && status.ci_state === 'passing') {
      return { kind: 'ready', key: `ready:${item.external_url}:${status.updated_at || ''}`, item };
    }
    if (policy.merge_when_approved && status.state === 'open' && status.review_state === 'approved' && status.ci_state === 'passing') {
      return { kind: 'merge', key: `merge:${item.external_url}:${status.updated_at || ''}`, item };
    }
  }

  const allPublishedMerged = publishedItems.length > 0
    && publishedItems.every((item) => item.pull_request_status?.state === 'merged');
  if (!allPublishedMerged) return null;
  if (policy.complete_source_after_merge) {
    const context = sourceContexts.find((candidate) => (
      candidate.kind === 'issue'
      && (candidate.provider === 'github' || candidate.provider === 'linear')
      && !hasPublishedDelivery(deliveries, candidate, 'complete_source')
    ));
    if (context) {
      return hasPublishedDelivery(deliveries, context, 'result')
        ? { kind: 'complete', key: `complete:${context.provider}:${context.url}`, context }
        : null;
    }
  }
  return policy.archive_after_merge ? { kind: 'archive', key: `archive:${sessionId}` } : null;
}
