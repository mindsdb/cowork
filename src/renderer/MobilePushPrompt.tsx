// The mobile app's soft push prompt (ENG-4023). Shown once, right after the
// user starts their first task, instead of the OS prompt at launch: the OS
// asks only once, so it is worth asking when the value is obvious.
// "Turn on" fires the OS prompt; "Not now" waits 14 days (lib/mobilePush.ts).

import { useCallback, useSyncExternalStore } from 'react';
import Button from './cowork/components/ui/Button';
import { Card } from './cowork/components/ui/Card';
import type { MobilePushController } from './lib/mobilePush';

const HIDDEN = { visible: false };

export function MobilePushPrompt({ controller }: { controller: MobilePushController | null }) {
  const subscribe = useCallback(
    (listener: () => void) => controller?.subscribe(listener) ?? (() => {}),
    [controller],
  );
  const state = useSyncExternalStore(subscribe, () => controller?.getSoftPrompt() ?? HIDDEN);
  if (!controller || !state.visible) return null;

  return (
    <Card
      variant="glass"
      padding="compact"
      role="region"
      aria-labelledby="mobile-push-prompt-title"
      data-testid="mobile-push-prompt"
      style={{
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div>
        <div id="mobile-push-prompt-title" style={{ fontWeight: 600, fontSize: 14 }}>
          Get notified when your tasks finish
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--ink-2)', marginTop: 2 }}>
          We'll also let you know when a scheduled task runs or someone shares an artifact with you.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="subtle" size="sm" onClick={() => controller.dismissSoftPrompt()}>
          Not now
        </Button>
        <Button variant="primary" size="sm" onClick={() => { void controller.acceptSoftPrompt(); }}>
          Turn on
        </Button>
      </div>
    </Card>
  );
}

export default MobilePushPrompt;
