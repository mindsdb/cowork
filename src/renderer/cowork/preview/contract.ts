export type DocumentPreviewType = 'xlsx' | 'docx' | 'pptx' | 'pdf';

export interface PreviewLimits {
  maxBytes: number;                 // 32 MiB, counted while streaming
  maxInflatedBytes: number;         // 256 MiB
  maxZipEntryInflatedBytes: number; // 64 MiB per entry
  maxZipEntries: number;            // 10,000
  maxSheetRows: number;             // 2,000
  maxSheetColumns: number;          // 200
  maxPdfPages: number;              // 500; past it the summary says truncated: true
  maxPdfCanvasPixels: number;       // 16,777,216 per page canvas; 4,194,304 on touch devices
  maxPdfCanvasesAlive: number;      // 6 page canvases drawn at once
  maxSlides: number;                // 300
  maxSlideElements: number;         // 100,000 read across the deck; past it the summary says truncated: true
  readyTimeoutMs: number;           // 10,000
  progressTimeoutMs: number;        // 20,000
}

/* What `units` counts for each type:
   - xlsx: the sheets shown as tabs.
   - pptx: the slides drawn, at most maxSlides. A larger deck draws the first
     maxSlides slides and reports truncated: true. Across the deck the
     renderer reads at most maxSlideElements elements of the slides' shape
     trees, tables and text, counting the master's and the layout's again on
     each slide and counting the ones it doesn't draw. A deck past that ends
     on the slide where the cap ran out, drawn up to the cap, and reports
     truncated: true.
   - pdf: the pages laid out, min(numPages, maxPdfPages). Pages draw as they
     scroll into view, with at most maxPdfCanvasesAlive canvases alive, so
     units never counts pages drawn. Each page draw runs under the parent's
     draw watchdog (RendererContext.beginDraw).
   - docx: always 1, the one rendered document. */
export interface RenderSummary { type: DocumentPreviewType; units: number; truncated: boolean }

/* Who raises each code:
   - too-large: the parent, when the streamed fetch passes maxBytes.
   - timeout: the parent, when the frame misses readyTimeoutMs or
     progressTimeoutMs, or when a draw the frame reported stays open for
     progressTimeoutMs of the page being visible with no draw ending in that
     time, before or after rendered.
   - zip-limit: the runtime's archive guard, past maxInflatedBytes,
     maxZipEntryInflatedBytes or maxZipEntries.
   - parse-failed: a renderer, for a file it can't read. The runtime's
     archive guard also raises it for a file that starts with PK but doesn't
     open as an archive, for an archive two zip readers could read
     differently, and for an archive entry with a ZIP64 extra field.
   - unsupported: a renderer, for a valid file it can't show.
   - internal: the runtime, for any other throw. */
export type PreviewErrorCode = 'too-large' | 'zip-limit' | 'parse-failed' | 'unsupported' | 'timeout' | 'internal';

/* render() fails with a code by rejecting with a PreviewError. errors.ts, the
   one shared helper for preview errors, builds one with previewError and
   recognizes one with isPreviewError. The runtime reports any other rejection
   as internal. A PreviewError whose code the frame doesn't own (too-large,
   timeout) is reported as internal too. */
export interface PreviewError extends Error { code: PreviewErrorCode }

export interface GuardedZip {
  names(): readonly string[];
  bytes(name: string): Promise<Uint8Array | null>;
  text(name: string): Promise<string | null>;
}

export interface RendererContext {
  root: HTMLElement;
  limits: PreviewLimits;
  signal: AbortSignal;
  progress(done: number, total: number | null): void;
  openZip(bytes: ArrayBuffer): Promise<GuardedZip>;
  requestAsset(name: string): Promise<Uint8Array | null>;
  /* Starts the parent's watchdog on one draw the renderer runs on its own,
     such as a PDF page that scrolls into view, before or after render()
     resolves. A draw open for progressTimeoutMs of the page being visible,
     with no draw ending in that time, removes the frame with timeout. The
     renderer calls the returned function once the draw finished, was
     cancelled or failed; later calls do nothing. */
  beginDraw(): () => void;
}

/* Before render(), the runtime runs its archive guard on every file that
   starts with PK and on every other file JSZip opens as an archive, because
   JSZip also opens an archive with bytes prepended to it. The guard reads the
   end record, the central directory and each local header itself, and
   inflates every entry to count its bytes. It raises parse-failed for a file
   that starts with PK but doesn't open as an archive, and for an archive two
   zip readers could read differently, such as one with bytes prepended that
   its offsets don't count, a name listed twice, a local header that differs
   from its directory record, or an entry that inflates to another size than
   it states. It also raises parse-failed for an entry with a ZIP64 extra
   field, and zip-limit past the caps. An end record whose 16-bit entry count
   is past maxZipEntries, the ZIP64 marker 0xFFFF included, also ends in
   zip-limit. In any file with an end record,
   whatever the file starts with, it counts the central directory signatures
   before JSZip reads the file, and more than maxZipEntries of them ends it
   with zip-limit. A file the guard ends never reaches render(). So render()
   receives only bytes that passed the guard, a library that unzips them
   itself reads only checked entries, and ctx.openZip(bytes) returns that
   checked archive. */
export interface DocumentRenderer {
  type: DocumentPreviewType;
  render(bytes: ArrayBuffer, ctx: RendererContext): Promise<RenderSummary>;
}

/* The parent calls load(name) only when names.includes(name) holds exactly.
   Any other name gets bytes: null, with no load and no fetch. */
export interface PreviewAssetProvider { names: readonly string[]; load(name: string): Promise<ArrayBuffer | null> }

/* Frame protocol. The token is 128 bits from crypto.getRandomValues, in
   <meta name="cowork-preview-token"> after the policy meta and before the hashed
   script. The parent accepts one FrameReady per mounted frame and sends one port. */
export interface FrameReady { source: 'cowork-document-preview'; type: 'ready'; token: string }
export interface ParentPort { type: 'port'; token: string }
export type ParentToFrame =
  | { token: string; type: 'document'; previewType: DocumentPreviewType; bytes: ArrayBuffer }
  | { token: string; type: 'asset'; requestId: number; name: string; bytes: ArrayBuffer | null };
export type FrameToParent =
  | { token: string; type: 'progress'; done: number; total: number | null }
  | { token: string; type: 'rendered'; summary: RenderSummary }
  | { token: string; type: 'asset-request'; requestId: number; name: string }
  | { token: string; type: 'draw'; id: number; state: 'start' | 'end' }
  | { token: string; type: 'error'; code: PreviewErrorCode; detail?: string };
