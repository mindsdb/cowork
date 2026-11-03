/*
 * The viewer header's Export button. It lists the formats the server offers
 * this caller for this artifact, runs one export at a time, saves the new file
 * and shows the answer's message under the button. The message region stays
 * mounted, so a screen reader hears each message as it arrives.
 */
import { useEffect, useRef, useState } from 'react';
import Ico from '../../Icons';
import { Button, Menu, Spinner } from '../../ui';
import { cn } from '../../../lib/cn';
import { EXPORT_FORMAT_LABELS, runArtifactExport } from '../../../lib/artifactExport';

/** @typedef {import('../../../lib/artifactExport').ExportNotice} ExportNotice */

/** How long a message stays under the button. */
const NOTICE_MS = 6_000;

/**
 * @param {{
 *   draftUrl: string,
 *   formats: import('..').ArtifactExportFormat[],
 * }} props
 */
export function ArtifactExportMenu({ draftUrl, formats }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(/** @type {ExportNotice | null} */ (null));
  const noticeTimerRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.clearTimeout(noticeTimerRef.current);
    };
  }, []);

  /** @param {ExportNotice | null} next */
  const showNotice = (next) => {
    window.clearTimeout(noticeTimerRef.current);
    setNotice(next);
    if (next) noticeTimerRef.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  };

  /* The export and its download finish even when the viewer closes or
     switches files first; only this button's state stops updating. */
  const exportAs = async (format) => {
    setBusy(true);
    showNotice(null);
    const next = await runArtifactExport(draftUrl, format);
    if (!mountedRef.current) return;
    showNotice(next);
    setBusy(false);
  };

  return (
    <div className="relative">
      <Menu
        ariaLabel="Export formats"
        align="end"
        width={140}
        trigger={
          <Button size="sm" disabled={busy}>
            {busy
              ? (<><Spinner style={{ color: 'currentColor' }} /> Exporting…</>)
              : (<>Export <span className="inline-flex text-ink-3">{Ico.chevDown(14)}</span></>)}
          </Button>
        }
        items={formats.map((format) => ({
          key: format,
          label: EXPORT_FORMAT_LABELS.get(format),
          onClick: () => exportAs(format),
        }))}
      />
      <div
        role="status"
        className={notice
          ? cn(
            'absolute right-0 top-[calc(100%+6px)] z-[5] w-max max-w-[280px]',
            'rounded-card-row bg-surface shadow-sh-popup px-3 py-2 font-body text-[12.5px] leading-snug',
            notice.tone === 'error' ? 'text-danger' : 'text-ink-2',
          )
          : undefined}
      >
        {notice?.text}
      </div>
    </div>
  );
}

export default ArtifactExportMenu;
