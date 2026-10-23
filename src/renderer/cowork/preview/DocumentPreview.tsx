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
 * so only after that download succeeded; desktop offers `openInDefaultApp`.
 * Every note renders inside this component, and a crash in it shows the same
 * note instead of a blank viewer.
 */
import { Component, useEffect, useRef, useState, type ReactNode } from 'react';

import { host } from '../../platform/host';
import Button from '../components/ui/Button';
import Spinner from '../components/ui/Spinner';
import type { DocumentPreviewType, PreviewErrorCode, RenderSummary } from './contract';
import { DocumentPreviewFrame } from './DocumentPreviewFrame';
import { isPreviewError, previewError } from './errors';
import { previewBundles } from './generated/registry';
import { PREVIEW_PARENT_LIMITS, previewLimits } from './limits';
import { loadPreviewBundle, type LoadedPreviewBundle } from './runtime/bundle';
import { readPreviewBytes } from './runtime/readBytes';
import './documentPreview.css';

export interface DocumentPreviewSource {
  url: string;
  previewType: DocumentPreviewType;
  filename: string;
}

export interface DocumentPreviewProps {
  source: DocumentPreviewSource;
  /* The caller's credentialed GET of source.url. It resolves only for a 2xx. */
  fetchFile(url: string, signal: AbortSignal): Promise<Response>;
  /* Web: saves the file. Resolves true only when the download succeeded. */
  download(): Promise<boolean>;
  /* Desktop: opens the file in its default app. */
  openInDefaultApp(): void;
  /* The file itself couldn't be fetched, so there is nothing to preview. */
  onLoadError(error: unknown): void;
}

export const PREVIEW_FAILED_NOTE = "Couldn't preview this file";
export const PREVIEW_FAILED_DOWNLOADED_NOTE = "Couldn't preview this file; downloaded instead.";
export const DOWNLOAD_FAILED_NOTE = "Couldn't download this file.";

const MIB = 1024 * 1024;

export const PREVIEW_FAILURE_REASONS: Readonly<Record<PreviewErrorCode, string>> = {
  'too-large': `The file is larger than the ${PREVIEW_PARENT_LIMITS.maxBytes / MIB} MiB preview limit.`,
  'zip-limit': "The file unpacks past the preview's archive limits.",
  'parse-failed': "The file can't be read.",
  unsupported: 'The file uses something the preview does not support.',
  timeout: 'The preview took too long.',
  internal: 'The preview stopped on an unexpected error.',
};

/* The caps that decide truncation are the same on every device. */
const CAPS = previewLimits({ touch: false });

const TRUNCATED_PART: Readonly<Record<DocumentPreviewType, { shown: string; whole: string }>> = {
  xlsx: {
    shown: `Showing up to ${CAPS.maxSheetRows.toLocaleString('en-US')} rows and ${CAPS.maxSheetColumns.toLocaleString('en-US')} columns of each sheet.`,
    whole: 'sheet',
  },
  pptx: { shown: `Showing the first ${CAPS.maxSlides.toLocaleString('en-US')} slides.`, whole: 'deck' },
  pdf: { shown: `Showing the first ${CAPS.maxPdfPages.toLocaleString('en-US')} pages.`, whole: 'file' },
  docx: { shown: 'Showing part of this document.', whole: 'file' },
};

export function truncationLine(type: DocumentPreviewType, isWeb: boolean): string {
  const { shown, whole } = TRUNCATED_PART[type];
  return `${shown} ${isWeb ? 'Download' : 'Open'} has the full ${whole}.`;
}

interface FailureProps {
  code: PreviewErrorCode;
  download(): Promise<boolean>;
  openInDefaultApp(): void;
}

/* On web it downloads the file once, and claims the download only after it
   succeeded. On desktop it offers Open. */
function PreviewFailure({ code, download, openInDefaultApp }: FailureProps) {
  const [downloaded, setDownloaded] = useState<boolean | null>(null);
  const started = useRef(false);
  const save = () => {
    setDownloaded(null);
    download().then(setDownloaded, () => setDownloaded(false));
  };
  /* Downloads once per failure; any later download is the user's click. */
  useEffect(() => {
    if (!host.isWeb || started.current) return;
    started.current = true;
    save();
  }, []);
  return (
    <div className="document-preview-note" role="status">
      <p className="document-preview-note-title">
        {host.isWeb && downloaded ? PREVIEW_FAILED_DOWNLOADED_NOTE : PREVIEW_FAILED_NOTE}
      </p>
      <p className="document-preview-note-reason">{PREVIEW_FAILURE_REASONS[code]}</p>
      {host.isWeb
        ? downloaded === false && <Button onClick={save}>Download</Button>
        : <Button onClick={openInDefaultApp}>Open</Button>}
    </div>
  );
}

interface TruncationBarProps {
  previewType: DocumentPreviewType;
  download(): Promise<boolean>;
  openInDefaultApp(): void;
}

/* Says what the preview left out and offers the whole file. On web a failed
   download says so beside the button, which stays for a retry; the viewer's
   own error would replace the frame, so the bar keeps the message itself. */
function TruncationBar({ previewType, download, openInDefaultApp }: TruncationBarProps) {
  const [saveFailed, setSaveFailed] = useState(false);
  const save = () => {
    setSaveFailed(false);
    download().then((ok) => setSaveFailed(!ok), () => setSaveFailed(true));
  };
  return (
    <div className="document-preview-truncated" role="note">
      <span>{truncationLine(previewType, host.isWeb)}</span>
      {host.isWeb && saveFailed && (
        <span className="document-preview-truncated-error" role="alert">{DOWNLOAD_FAILED_NOTE}</span>
      )}
      <Button onClick={host.isWeb ? save : openInDefaultApp}>
        {host.isWeb ? 'Download' : 'Open'}
      </Button>
    </div>
  );
}

interface LoadedFile {
  bytes: ArrayBuffer;
  bundle: LoadedPreviewBundle;
}

function DocumentPreviewBody({ source, fetchFile, download, openInDefaultApp, onLoadError }: DocumentPreviewProps) {
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [summary, setSummary] = useState<RenderSummary | null>(null);
  const [failure, setFailure] = useState<PreviewErrorCode | null>(null);
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
        else setFailure('unsupported');
      },
      (error: unknown) => {
        if (signal.aborted) return;
        if (isPreviewError(error)) setFailure(error.code);
        else onLoadErrorRef.current(error);
      },
    );
    return () => controller.abort();
  }, []);

  if (failure) {
    return <PreviewFailure code={failure} download={download} openInDefaultApp={openInDefaultApp} />;
  }
  return (
    <>
      {loaded && (
        <DocumentPreviewFrame
          previewType={source.previewType}
          bytes={loaded.bytes}
          bundle={loaded.bundle}
          title={`Preview of ${source.filename}`}
          onRendered={setSummary}
          onError={setFailure}
        />
      )}
      {!summary && (
        <div className="document-preview-loading" aria-live="polite">
          <Spinner /> Loading preview…
        </div>
      )}
      {summary?.truncated && (
        <TruncationBar previewType={source.previewType} download={download} openInDefaultApp={openInDefaultApp} />
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
        fallback={<PreviewFailure code="internal" download={props.download} openInDefaultApp={props.openInDefaultApp} />}
      >
        <DocumentPreviewBody {...props} />
      </PreviewErrorBoundary>
    </div>
  );
}

export default DocumentPreview;
