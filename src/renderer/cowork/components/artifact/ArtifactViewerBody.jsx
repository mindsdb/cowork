import { useEffect, useState } from 'react';
import Ico from '../Icons';
import { Button, Spinner } from '../ui';
import { host } from '../../../platform/host';
import { MarkdownContent } from '../markdown/MarkdownContent';
import { CommentsPanel, CommentsToolbar } from './comments';
import { ArtifactComparison } from './workspace/ArtifactComparison';
import { ArtifactSourceEditor } from './workspace/ArtifactSourceEditor';
import { TextSelectionComment } from './workspace/TextSelectionComment';

const FONT_BODY = "'Inter', system-ui, sans-serif";
const FONT_DISPLAY = "var(--font-display, 'Inter', sans-serif)";
const FONT_MONO = "var(--font-mono)";

// Full-bleed "Preview" placeholder shown over the preview region until the
// iframe has actually painted (or while a text preview is fetching), so the
// user never sees a flash of empty grey.
function PreviewPlaceholder() {
  return (
    <div aria-hidden="true" style={{
      position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
      background: 'var(--surface-2)', overflow: 'hidden',
    }}>
      <span style={{
        fontFamily: FONT_DISPLAY, fontWeight: 600,
        fontSize: 'clamp(40px, 9vw, 84px)', color: 'var(--ink)', opacity: 0.06,
        transform: 'rotate(-12deg)', letterSpacing: '-0.02em',
        userSelect: 'none', whiteSpace: 'nowrap',
      }}>Preview</span>
      <div style={{
        position: 'absolute', bottom: 22,
        display: 'flex', alignItems: 'center', gap: 8,
        color: 'var(--ink-4)', fontFamily: FONT_BODY, fontSize: 12,
      }}>
        <Spinner /> Loading preview…
      </div>
    </div>
  );
}

export function ArtifactViewerBody({
  workspace,
  preview,
  review,
  agentReview,
}) {
  const {
    draftUrl: draftPreviewUrl,
    error: err,
    setError: setErr,
    isText,
    isImage,
    imageSrc,
    imageFailed,
    loading,
    text: textPreview,
    textContentRef,
    captureTextSelection,
    textExtension: textExt,
    artifact,
    csv: csvPreview,
    onDownload,
    onOpenOS,
    url: previewUrl,
    kind: previewKind,
    iframeRef,
    title,
    iframeReady,
    setIframeReady,
    onReload,
  } = preview;
  const {
    layer,
    open: commentsOpen,
    enabled: commentsEnabled,
    inboxOpen,
    setInboxOpen,
    markersShown,
    setMarkersShown,
    onToggle: toggleComments,
    userDir: commentUserDir,
    reportId: commentReportId,
    controller: comments,
    onAddressWithAgent: addressCommentWithAgent,
    onCreate: createArtifactComment,
    textSelection,
    setTextSelection,
  } = review;
  const { busy: repairBusy, setBusy: setRepairBusy } = agentReview;
  const sourcePath = workspace.source?.path || '';
  const htmlSource = !!workspace.source && (
    workspace.source.contentType === 'html'
    || workspace.source.contentType === 'htm'
    || /\.html?$/i.test(sourcePath)
  );
  const editorKey = htmlSource ? `${workspace.source.artifactId || ''}:${sourcePath}` : '';
  const showEditor = workspace.mode === 'edit' && !!workspace.source;
  const [retainedEditorKey, setRetainedEditorKey] = useState('');

  // Once the preview has painted, prepare the HTML editor during idle time.
  // The first Edit click is then a surface swap, not a second parse/download;
  // after visiting Edit we keep both iframes alive for instant mode changes.
  useEffect(() => {
    if (!editorKey || retainedEditorKey === editorKey) return undefined;
    if (showEditor) {
      setRetainedEditorKey(editorKey);
      return undefined;
    }
    if (!iframeReady) return undefined;
    const prepare = () => setRetainedEditorKey(editorKey);
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(prepare, { timeout: 1200 });
      return () => window.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(prepare, 80);
    return () => window.clearTimeout(handle);
  }, [editorKey, iframeReady, retainedEditorKey, showEditor]);

  const sourceEditor = workspace.source ? (
    <ArtifactSourceEditor
      source={workspace.source}
      value={workspace.draft}
      onChange={workspace.setDraft}
      onSave={(content) => workspace.save('Edited artifact', content)}
      draftUrl={draftPreviewUrl}
    />
  ) : null;

  const previewContent = err ? (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 28 }}>
      <div style={{ color: 'var(--danger)', fontSize: 13, textAlign: 'center', maxWidth: 460, fontFamily: FONT_BODY }}>{err}</div>
    </div>
  ) : isText ? (
    loading || !textPreview ? (
      <PreviewPlaceholder />
    ) : (
      <div
        ref={textContentRef}
        onMouseUp={captureTextSelection}
        style={{
          maxWidth: 920, margin: '0 auto', padding: '24px 28px',
          background: 'var(--surface)', minHeight: '100%',
        }}
      >
        {textExt === '.md' ? (
          <MarkdownContent text={textPreview.content} id={artifact.path} />
        ) : textExt === '.csv' && csvPreview ? (
          <MarkdownContent text={csvPreview.markdown} id={artifact.path} />
        ) : (
          <pre style={{
            margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            fontFamily: FONT_MONO, fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.55,
          }}>{textPreview.content}</pre>
        )}
        {(textPreview.truncated || (csvPreview && csvPreview.truncated)) && (
          <div style={{
            marginTop: 18, padding: '10px 14px', borderRadius: 8,
            background: 'var(--surface-2)', border: '1px solid var(--line)',
            color: 'var(--ink-3)', fontSize: 12.5, fontFamily: FONT_BODY,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, flexWrap: 'wrap',
          }}>
            <span>
              {csvPreview && csvPreview.truncated
                ? `Showing first ${csvPreview.shownRows.toLocaleString()} of ${csvPreview.totalRows.toLocaleString()} rows.`
                : 'Preview is truncated.'}
            </span>
            <Button onClick={host.isWeb ? onDownload : onOpenOS}>
              {host.isWeb ? Ico.download(13) : Ico.externalLink(13)}
              {host.isWeb ? 'Download full file' : 'Open full file in OS'}
            </Button>
          </div>
        )}
      </div>
    )
  ) : isImage ? (
    imageFailed ? (
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 28 }}>
        <div style={{ color: 'var(--ink-3)', fontSize: 13, fontFamily: FONT_BODY }}>Could not load image.</div>
      </div>
    ) : imageSrc ? (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <img
          src={imageSrc}
          alt={title || 'Artifact preview'}
          style={{ maxWidth: '100%', maxHeight: '100%', width: 'auto', height: 'auto', objectFit: 'contain' }}
        />
      </div>
    ) : (
      <PreviewPlaceholder />
    )
  ) : (
    <>
      {previewUrl && (
        <iframe
          ref={iframeRef}
          title={title || 'Artifact preview'}
          // The comment-layer activation flag (when applicable) is already
          // baked into previewUrl at mount time, so the src stays stable.
          src={previewUrl}
          onLoad={() => { setIframeReady(true); layer.onIframeLoad(); }}
          sandbox={previewKind === 'proxy'
            ? 'allow-scripts allow-same-origin allow-popups allow-forms allow-modals'
            : 'allow-scripts allow-popups allow-forms allow-modals'}
          style={{
            width: '100%', height: '100%', border: 0, background: '#fff',
            opacity: iframeReady ? 1 : 0, transition: 'opacity 180ms ease',
          }}
        />
      )}
      {(loading || !previewUrl || !iframeReady) && <PreviewPlaceholder />}
    </>
  );

  return (
    <>
      {/* Text renders inline; other artifacts use a sandboxed iframe. */}
      <div className={`artifact-viewer-body${commentsOpen && inboxOpen ? ' has-comments-inbox' : ''}`}>
        <div className="artifact-review-stage">
          <div className="artifact-viewer-canvas" style={{ overflow: isText ? 'auto' : 'hidden' }}>
            {htmlSource ? (
              <>
                {(showEditor || retainedEditorKey === editorKey) && (
                  <div className="artifact-mode-surface" hidden={!showEditor}>{sourceEditor}</div>
                )}
                <div className="artifact-mode-surface" hidden={showEditor}>{previewContent}</div>
              </>
            ) : showEditor ? sourceEditor : previewContent}
          </div>
          {/* The compact toolbar is for placing and revealing comments. The
              inbox replaces it while open so controls never overlap. */}
          {commentsOpen && commentsEnabled && !inboxOpen && (
            <CommentsToolbar
              mode={layer.mode}
              onToggleMode={layer.toggleMode}
              inboxOpen={inboxOpen}
              onToggleInbox={() => setInboxOpen((v) => !v)}
              markersShown={markersShown}
              onToggleMarkers={() => setMarkersShown((v) => !v)}
              onClose={toggleComments}
            />
          )}
          {textSelection && workspace.mode === 'review' && (
            <TextSelectionComment
              selection={textSelection}
              onCancel={() => setTextSelection(null)}
              onCreate={createArtifactComment}
            />
          )}
        </div>
        {/* Review is a docked workspace on desktop and a full panel on compact screens. */}
        {commentsOpen && inboxOpen && commentsEnabled && commentUserDir && commentReportId && (
          <CommentsPanel
            threads={comments.threads}
            anchorStates={layer.anchorStates}
            error={comments.error}
            expired={comments.expired}
            viewer={comments.viewer}
            capabilities={comments.capabilities}
            onStatus={comments.setStatus}
            onAddressWithAgent={workspace.capabilities?.canAddressWithAgent !== false
              ? addressCommentWithAgent
              : undefined}
            onDeleteThread={comments.deleteThread}
            onCreate={createArtifactComment}
            onHoverThread={layer.hlOn}
            onLeaveThread={layer.hlOff}
            onFocusThread={layer.focus}
            onClose={() => setInboxOpen(false)}
          />
        )}
        <ArtifactComparison
          comparison={workspace.comparison}
          busy={repairBusy || workspace.status === 'saving'}
          contentType={workspace.source?.contentType}
          baseUrl={draftPreviewUrl}
          onClose={() => workspace.setComparison(null)}
          onRestore={workspace.restoreRevision}
          onReject={async () => {
            setRepairBusy(true);
            try {
              await workspace.decideRepair('rejected');
            } catch (decisionError) {
              setErr(decisionError?.message || 'Could not reject the agent change. Try again.');
            } finally {
              setRepairBusy(false);
            }
          }}
          onAccept={async () => {
            const threadId = workspace.repair?.commentThreadId;
            setRepairBusy(true);
            try {
              await workspace.decideRepair('accepted');
              const resolved = threadId
                ? await comments.setStatus(threadId, 'resolved')
                : true;
              if (!resolved) {
                setErr('The change was accepted, but the comment could not be resolved. Try resolving it again.');
              }
              await workspace.load();
              onReload();
            } catch (decisionError) {
              setErr(decisionError?.message || 'Could not accept the agent change. Try again.');
            } finally {
              setRepairBusy(false);
            }
          }}
        />
      </div>
    </>
  );
}

export default ArtifactViewerBody;
