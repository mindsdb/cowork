/*
 * The parent half of the document preview frame protocol.
 *
 * It mounts one sandboxed srcdoc iframe with a fresh token, accepts the first
 * FrameReady that carries that token, sends the frame one port, and transfers
 * the file's bytes over it. It checks the token, never event.source.
 *
 * With no ready within readyTimeoutMs, or no message from the frame for
 * progressTimeoutMs, it removes the frame and reports timeout; the policy
 * never changes. A frame that loads a second time was navigated or reloaded,
 * so it is rebuilt with a new token, at most once per mount; a third load
 * removes it and reports internal. An error the frame reports leaves the frame
 * in place, so the caller decides what replaces it.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import type {
  DocumentPreviewType,
  ParentPort,
  ParentToFrame,
  PreviewErrorCode,
  RenderSummary,
} from './contract';
import { buildPreviewSrcdoc, PREVIEW_FRAME_NAME, PREVIEW_SANDBOX, previewFramePolicy } from './frameDocument';
import { PREVIEW_PARENT_LIMITS, type PreviewParentLimits } from './limits';
import type { LoadedPreviewBundle } from './runtime/bundle';
import { newPreviewToken, readFrameReady, readFrameToParent } from './runtime/protocol';

export interface DocumentPreviewFrameProps {
  previewType: DocumentPreviewType;
  bytes: ArrayBuffer;
  bundle: LoadedPreviewBundle;
  title: string;
  limits?: Readonly<PreviewParentLimits>;
  onRendered(summary: RenderSummary): void;
  onError(code: PreviewErrorCode, detail?: string): void;
}

interface FrameMount {
  token: string;
  rebuilt: boolean;
}

export function DocumentPreviewFrame({
  previewType,
  bytes,
  bundle,
  title,
  limits = PREVIEW_PARENT_LIMITS,
  onRendered,
  onError,
}: DocumentPreviewFrameProps) {
  const [mount, setMount] = useState<FrameMount>(() => ({ token: newPreviewToken(), rebuilt: false }));
  const [removed, setRemoved] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const handlers = useRef({ onRendered, onError });
  handlers.current = { onRendered, onError };
  const srcdoc = useMemo(() => buildPreviewSrcdoc({
    policy: previewFramePolicy(bundle.scriptSha256),
    token: mount.token,
    scriptText: bundle.scriptText,
    scriptSha256: bundle.scriptSha256,
  }), [bundle, mount.token]);

  /* A layout effect, so the listeners exist before the frame can load or post. */
  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || removed) return undefined;
    const { token } = mount;
    let channel: MessageChannel | null = null;
    let settled = false;
    let loads = 0;
    let progressTimer: number | undefined;
    const readyTimer = window.setTimeout(() => remove('timeout'), limits.readyTimeoutMs);
    const stopTimers = () => {
      window.clearTimeout(readyTimer);
      window.clearTimeout(progressTimer);
    };
    const armProgress = () => {
      window.clearTimeout(progressTimer);
      progressTimer = window.setTimeout(() => remove('timeout'), limits.progressTimeoutMs);
    };
    const settle = () => {
      if (settled) return false;
      settled = true;
      stopTimers();
      return true;
    };
    /* The parent's own failures remove the frame. */
    function remove(code: PreviewErrorCode, detail?: string) {
      if (!settle()) return;
      setRemoved(true);
      handlers.current.onError(code, detail);
    }
    const answerAsset = async (port: MessagePort, requestId: number, name: string) => {
      const { assets } = bundle;
      let assetBytes: ArrayBuffer | null = null;
      if (assets && assets.names.includes(name)) {
        try {
          assetBytes = await assets.load(name);
        } catch {
          assetBytes = null;
        }
      }
      const reply: ParentToFrame = { token, type: 'asset', requestId, name, bytes: assetBytes };
      port.postMessage(reply);
    };
    const onFrameMessage = (port: MessagePort) => (event: MessageEvent) => {
      const message = readFrameToParent(event.data, token);
      if (!message) return;
      if (message.type === 'asset-request') {
        if (!settled) armProgress();
        void answerAsset(port, message.requestId, message.name);
        return;
      }
      if (message.type === 'progress') {
        if (!settled) armProgress();
      } else if (message.type === 'rendered') {
        if (settle()) handlers.current.onRendered(message.summary);
      } else if (settle()) {
        handlers.current.onError(message.code, message.detail);
      }
    };
    const onWindowMessage = (event: MessageEvent) => {
      if (channel || settled || !readFrameReady(event.data, token)) return;
      const frameWindow = iframe.contentWindow;
      if (!frameWindow) return;
      window.clearTimeout(readyTimer);
      armProgress();
      channel = new MessageChannel();
      channel.port1.onmessage = onFrameMessage(channel.port1);
      const portMessage: ParentPort = { type: 'port', token };
      frameWindow.postMessage(portMessage, '*', [channel.port2]);
      /* The frame gets its own copy, so a rebuilt frame can get the bytes again. */
      const copy = bytes.slice(0);
      const documentMessage: ParentToFrame = { token, type: 'document', previewType, bytes: copy };
      channel.port1.postMessage(documentMessage, [copy]);
    };
    const onLoad = () => {
      loads += 1;
      if (loads < 2) return;
      if (mount.rebuilt) {
        remove('internal', 'The preview frame loaded again after its rebuild.');
        return;
      }
      settle();
      setMount({ token: newPreviewToken(), rebuilt: true });
    };
    window.addEventListener('message', onWindowMessage);
    iframe.addEventListener('load', onLoad);
    return () => {
      settled = true;
      stopTimers();
      window.removeEventListener('message', onWindowMessage);
      iframe.removeEventListener('load', onLoad);
      channel?.port1.close();
    };
  }, [bundle, bytes, limits, mount, previewType, removed]);

  if (removed) return null;
  return (
    <iframe
      key={mount.token}
      ref={iframeRef}
      className="document-preview-frame"
      title={title}
      name={PREVIEW_FRAME_NAME}
      sandbox={PREVIEW_SANDBOX}
      srcDoc={srcdoc}
    />
  );
}

export default DocumentPreviewFrame;
