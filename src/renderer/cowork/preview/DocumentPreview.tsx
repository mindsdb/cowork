/*
 * A read-only preview of one .xlsx, .docx, .pptx or .pdf file, rendered in
 * the sandboxed document frame.
 *
 * It takes a plain source and its caller's callbacks, so it knows nothing
 * about artifacts. It fetches the file once through `fetchFile`, reading at
 * most maxBytes, loads the type's bundle, and mounts DocumentPreviewFrame. A
 * file that can't be fetched goes to `onLoadError`; a bundle that doesn't load
 * fails the preview with the internal reason.
 * Unmounting it, which a close or a file switch does, aborts the read and
 * removes the frame; the next file mounts a new frame with a new token.
 *
 * When the preview fails, web downloads the file through `download` and says
 * so only after that download succeeded; desktop offers `openInDefaultApp`,
 * or Download when the caller's `fileAction` says the file downloads there
 * too. Every note renders inside this component, and a crash in it shows the
 * same note instead of a blank viewer.
 */
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';

import { host } from '../../platform/host';
import i18n, { useTranslation } from '../../lib/i18n';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import type { DocumentPreviewType, PreviewErrorCode, PreviewFailure, PreviewFailureLimit, RenderSummary } from './contract';
import { DocumentPreviewFrame } from './DocumentPreviewFrame';
import { isPreviewError, previewError } from './errors';
import { previewBundles } from './generated/registry';
import { PREVIEW_PARENT_LIMITS, previewLimits } from './limits';
import { loadPreviewBundle, type LoadedPreviewBundle } from './runtime/bundle';
import { readPreviewBytes } from './runtime/readBytes';
import './documentPreview.css';
import { MOBILE_DOWNLOAD_NOTE } from '../lib/browserDownload';

export interface DocumentPreviewSource {
  url: string;
  previewType: DocumentPreviewType;
  filename: string;
}

export interface DocumentPreviewProps {
  source: DocumentPreviewSource;
  /* The caller's credentialed GET of source.url. It resolves only for a 2xx. */
  fetchFile(url: string, signal: AbortSignal): Promise<Response>;
  /* Saves the file. Resolves true only when the download succeeded. */
  download(): Promise<boolean>;
  /* Opens the file in its default app. */
  openInDefaultApp(): void;
  /* The file itself couldn't be fetched, so there is nothing to preview. */
  onLoadError(error: unknown): void;
  /* What the preview offers for the whole file: 'download' calls `download`,
     'open' calls `openInDefaultApp`. Left out, web downloads and desktop
     opens. */
  fileAction?: 'download' | 'open';
}

/* Whether the preview offers the whole file as a download rather than Open. */
function downloadsFile(fileAction: DocumentPreviewProps['fileAction']): boolean {
  return (fileAction ?? (host.isWeb ? 'download' : 'open')) === 'download';
}

const tr = (key: string, vars?: Record<string, unknown>): string =>
  i18n.t(key, { ns: 'artifacts', ...vars });

/* The notes, in the current language. The English constants below stay for
   callers and tests that match the text. */
export const previewFailedNote = () => tr('documentPreview.failed');
export const previewFailedDownloadedNote = () => tr('documentPreview.failedDownloaded');
export const downloadFailedNote = () => tr('documentPreview.downloadFailed');

export const PREVIEW_FAILED_NOTE = "Couldn't preview this file";
export const PREVIEW_FAILED_DOWNLOADED_NOTE = "Couldn't preview this file; downloaded instead.";
export const DOWNLOAD_FAILED_NOTE = "Couldn't download this file.";

/* A record whose values are read through i18n each time, so they follow the
   current language. */
function translatedRecord<K extends string>(entries: Record<K, () => string>): Readonly<Record<K, string>> {
  const record = {} as Record<K, string>;
  for (const key of Object.keys(entries) as K[]) {
    Object.defineProperty(record, key, { enumerable: true, get: entries[key] });
  }
  return Object.freeze(record);
}

const MIB = 1024 * 1024;

/* The caps that end a preview or decide truncation are the same on every
   device. */
const CAPS = previewLimits({ touch: false });

/* What the note says for a failure that names no limit. */
export const PREVIEW_FAILURE_REASONS: Readonly<Record<PreviewErrorCode, string>> = translatedRecord({
  'too-large': () => tr('documentPreview.reasons.tooLarge'),
  'zip-limit': () => tr('documentPreview.reasons.zipLimit'),
  'parse-failed': () => tr('documentPreview.reasons.parseFailed'),
  unsupported: () => tr('documentPreview.reasons.unsupported'),
  timeout: () => tr('documentPreview.reasons.timeout'),
  internal: () => tr('documentPreview.reasons.internal'),
});

/* What the note says for a failure past a limit: the limit and its value,
   from the parent's own caps. The frame names only which limit it passed, so
   no text from the frame reaches the note. */
export const PREVIEW_LIMIT_REASONS: Readonly<Record<PreviewFailureLimit, string>> = translatedRecord({
  maxBytes: () => tr('documentPreview.limits.maxBytes', { mib: CAPS.maxBytes / MIB }),
  maxInflatedBytes: () => tr('documentPreview.limits.maxInflatedBytes', { mib: CAPS.maxInflatedBytes / MIB }),
  maxZipEntryInflatedBytes: () =>
    tr('documentPreview.limits.maxZipEntryInflatedBytes', { mib: CAPS.maxZipEntryInflatedBytes / MIB }),
  maxZipEntries: () => tr('documentPreview.limits.maxZipEntries', { count: CAPS.maxZipEntries }),
  maxDocxNodes: () => tr('documentPreview.limits.maxDocxNodes', { count: CAPS.maxDocxNodes }),
  readyTimeoutMs: () => tr('documentPreview.limits.readyTimeoutMs', { seconds: CAPS.readyTimeoutMs / 1000 }),
  progressTimeoutMs: () => tr('documentPreview.limits.progressTimeoutMs', { seconds: CAPS.progressTimeoutMs / 1000 }),
});

/* The note's reason line: the limit the file passed when the failure names
   one, else the code's own reason. */
export function previewFailureReason({ code, limit }: Pick<PreviewFailure, 'code' | 'limit'>): string {
  return limit ? PREVIEW_LIMIT_REASONS[limit] : PREVIEW_FAILURE_REASONS[code];
}

/* What a truncated preview of each type says, from the summary's units. A
   deck counts the slides it drew, since either the slide cap or the element
   cap can end it. */
export function truncationLine(type: DocumentPreviewType, units: number, downloads: boolean): string {
  const line = tr(`documentPreview.${host.isMobileShell ? 'truncatedMobile' : 'truncated'}.${type}`, {
    action: downloads ? 'download' : 'open',
    count: units,
    rows: CAPS.maxSheetRows,
    columns: CAPS.maxSheetColumns,
    pages: CAPS.maxPdfPages,
  });
  return host.isMobileShell ? `${line} ${MOBILE_DOWNLOAD_NOTE}` : line;
}

interface FailureProps {
  failure: Pick<PreviewFailure, 'code' | 'limit'>;
  downloads: boolean;
  download(): Promise<boolean>;
  openInDefaultApp(): void;
}

/* On web it downloads the file once, and claims the download only after it
   succeeded. On desktop it offers Open, or Download for a file that
   downloads there, which waits for a click: a desktop download can ask where
   to save, so a failed preview never opens that dialog on its own. */
function FailureNote({ failure, downloads, download, openInDefaultApp }: FailureProps) {
  const { t } = useTranslation('artifacts');
  const [downloaded, setDownloaded] = useState<boolean | null>(null);
  const started = useRef(false);
  const downloadsOnFailure = downloads && host.isWeb && !host.isMobileShell;
  const save = () => {
    setDownloaded(null);
    download().then(setDownloaded, () => setDownloaded(false));
  };
  /* Downloads once per failure; any later download is the user's click. */
  useEffect(() => {
    if (!downloadsOnFailure || started.current) return;
    started.current = true;
    save();
  }, []);
  return (
    <div className="document-preview-note" role="status">
      <p className="document-preview-note-title">
        {downloads && downloaded ? previewFailedDownloadedNote() : previewFailedNote()}
      </p>
      <p className="document-preview-note-reason">{previewFailureReason(failure)}</p>
      {host.isMobileShell ? <p>{MOBILE_DOWNLOAD_NOTE}</p> : downloads
        ? (!downloadsOnFailure || downloaded === false) && <Button onClick={save}>{t('documentPreview.download')}</Button>
        : <Button onClick={openInDefaultApp}>{t('documentPreview.open')}</Button>}
    </div>
  );
}

interface TruncationBarProps {
  previewType: DocumentPreviewType;
  /* The summary's units. */
  units: number;
  downloads: boolean;
  download(): Promise<boolean>;
  openInDefaultApp(): void;
}

/* Says what the preview left out and offers the whole file. A failed
   download says so beside the button, which stays for a retry; the viewer's
   own error would replace the frame, so the bar keeps the message itself. */
function TruncationBar({ previewType, units, downloads, download, openInDefaultApp }: TruncationBarProps) {
  const { t } = useTranslation('artifacts');
  const [saveFailed, setSaveFailed] = useState(false);
  const save = () => {
    setSaveFailed(false);
    download().then((ok) => setSaveFailed(!ok), () => setSaveFailed(true));
  };
  return (
    <div className="document-preview-truncated" role="note">
      <span>{truncationLine(previewType, units, downloads)}</span>
      {downloads && saveFailed && (
        <span className="document-preview-truncated-error" role="alert">{downloadFailedNote()}</span>
      )}
      {!host.isMobileShell && <Button onClick={downloads ? save : openInDefaultApp}>
        {downloads ? t('documentPreview.download') : t('documentPreview.open')}
      </Button>}
    </div>
  );
}

interface LoadedFile {
  bytes: ArrayBuffer;
  bundle: LoadedPreviewBundle;
}

function DocumentPreviewBody({ source, fetchFile, download, openInDefaultApp, onLoadError, fileAction }: DocumentPreviewProps) {
  const { t } = useTranslation('artifacts');
  const downloads = downloadsFile(fileAction);
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [summary, setSummary] = useState<RenderSummary | null>(null);
  const [failure, setFailure] = useState<PreviewFailure | null>(null);
  const onLoadErrorRef = useRef(onLoadError);
  onLoadErrorRef.current = onLoadError;

  /* One file per mount: DocumentPreview keys this body by its source. The
     bundle loads beside the file, but the file decides first: a failed fetch
     goes to onLoadError, and a bundle that didn't load fails the preview as
     internal only once the file has arrived. */
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const bundleLoad = loadPreviewBundle(previewBundles, source.previewType).catch((cause: unknown) => {
      throw previewError('internal', "The preview's renderer bundle did not load.", { cause });
    });
    /* Marks the rejection handled for the time before load() awaits it, and
       for when the file fails first and load() never does. */
    bundleLoad.catch(() => undefined);
    const load = async () => {
      const response = await fetchFile(source.url, signal);
      const bytes = await readPreviewBytes(response, PREVIEW_PARENT_LIMITS.maxBytes, signal);
      return { bytes, bundle: await bundleLoad };
    };
    load().then(
      ({ bytes, bundle }) => {
        if (signal.aborted) return;
        if (bundle) setLoaded({ bytes, bundle });
        else setFailure({ code: 'unsupported' });
      },
      (error: unknown) => {
        if (signal.aborted) return;
        if (isPreviewError(error)) setFailure({ code: error.code, limit: error.limit });
        else onLoadErrorRef.current(error);
      },
    );
    return () => controller.abort();
  }, []);

  if (failure) {
    return <FailureNote failure={failure} downloads={downloads} download={download} openInDefaultApp={openInDefaultApp} />;
  }
  return (
    <>
      {loaded && (
        <DocumentPreviewFrame
          previewType={source.previewType}
          bytes={loaded.bytes}
          bundle={loaded.bundle}
          title={t('documentPreview.frameTitle', { filename: source.filename })}
          onRendered={setSummary}
          onError={setFailure}
        />
      )}
      {!summary && (
        <div className="document-preview-loading" aria-live="polite">
          <Spinner /> {t('documentPreview.loading')}
        </div>
      )}
      {summary?.truncated && (
        <TruncationBar
          previewType={source.previewType}
          units={summary.units}
          downloads={downloads}
          download={download}
          openInDefaultApp={openInDefaultApp}
        />
      )}
    </>
  );
}

interface BoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

/* Turns a crash in the preview's own components into the failure note. */
class PreviewErrorBoundary extends Component<BoundaryProps, { crashed: boolean }> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  render() {
    return this.state.crashed ? this.props.fallback : this.props.children;
  }
}

export function DocumentPreview(props: DocumentPreviewProps) {
  const { source } = props;
  return (
    <div className="document-preview">
      <PreviewErrorBoundary
        key={`${source.previewType} ${source.url}`}
        fallback={(
          <FailureNote
            failure={{ code: 'internal' }}
            downloads={downloadsFile(props.fileAction)}
            download={props.download}
            openInDefaultApp={props.openInDefaultApp}
          />
        )}
      >
        <DocumentPreviewBody {...props} />
      </PreviewErrorBoundary>
    </div>
  );
}

export default DocumentPreview;
