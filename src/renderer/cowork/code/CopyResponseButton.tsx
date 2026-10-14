import { useEffect, useRef, useState } from 'react';
import Ico from '../components/Icons';
import Button from '../components/ui/Button';
import Tooltip from '../components/ui/Tooltip';
import { copyText } from '../lib/clipboard';

export function CopyResponseButton({ text }: { text: string }) {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const attempt = useRef(0);

  useEffect(() => {
    setStatus('idle');
    return () => { attempt.current += 1; };
  }, [text]);

  useEffect(() => {
    if (status !== 'copied') return;
    const timer = window.setTimeout(() => setStatus('idle'), 1600);
    return () => window.clearTimeout(timer);
  }, [status]);

  if (!text.trim()) return null;

  const copy = async () => {
    const current = ++attempt.current;
    setStatus('copying');
    const copied = await copyText(text);
    // A streamed update or a different response invalidates this result.
    if (current === attempt.current) setStatus(copied ? 'copied' : 'failed');
  };

  return (
    <div className="code-response-actions">
      <Tooltip content={status === 'copied' ? 'Copied' : 'Copy response'}>
        <Button icon variant="subtle" size="sm" aria-label="Copy response" disabled={status === 'copying'} onClick={() => void copy()}>
          {status === 'copied' ? Ico.check(14) : Ico.copy(14)}
        </Button>
      </Tooltip>
      <span role="status" className={status === 'failed' ? 'is-error' : ''}>
        {status === 'copied' ? 'Copied' : status === 'failed' ? 'Could not copy. Try again.' : ''}
      </span>
    </div>
  );
}
