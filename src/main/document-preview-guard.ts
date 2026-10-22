import { PREVIEW_FRAME_NAME } from '../shared/document-preview';

/*
 * The main process's half of the document preview frame's isolation.
 *
 * The preview frame is an in-page srcdoc frame, and every guard it carries
 * runs inside the frame's own process. On desktop the main process backs
 * those up in two ways:
 *
 * - It marks the preview frame when Electron creates it. At `frame-created`
 *   the frame already has the name attribute the renderer gives it
 *   (PREVIEW_FRAME_NAME) and has run no script. The mark is the frame's
 *   frameTreeNodeId, which Electron fixes when it creates the frame and keeps
 *   when the frame renames itself, changes process or navigates.
 *   mayCarryServerToken answers false for a marked frame, for any frame inside
 *   it, and for a request with no frame, and the server-token listener in
 *   app.ts then sends those requests without the Authorization header.
 * - It cancels a subframe's navigation when the frame is missing, sits at
 *   about:srcdoc, or sits inside a marked frame. That decision never reads a
 *   frame's name, so a frame that renames itself is still held. A cancelled
 *   navigation opens nothing anywhere else either. The one navigation it lets
 *   a srcdoc frame make is to about:srcdoc, which is the parent replacing the
 *   frame's srcdoc attribute, as the HTML comparison view does.
 *
 * Electron throws when a property of a frame whose render frame is gone is
 * read. Each such read here fails closed: an unreadable frame is marked, gets
 * no token, and may not navigate.
 */

/* The parts of Electron's WebFrameMain the guard reads. */
export interface GuardedFrame {
  readonly frameTreeNodeId: number;
  readonly name: string;
  readonly url: string;
  readonly parent: GuardedFrame | null;
}

/* The parts of Electron's will-frame-navigate event the guard reads. */
export interface FrameNavigation {
  readonly url: string;
  readonly isMainFrame: boolean;
  readonly frame: GuardedFrame | null;
  preventDefault(): void;
}

/* The part of Electron's frame-created details the guard reads. */
export interface FrameCreatedDetails {
  readonly frame: GuardedFrame | null;
}

/* The two WebContents events the guard listens to. Electron's WebContents fits it. */
export interface GuardedContents {
  on(event: 'frame-created', listener: (event: unknown, details: FrameCreatedDetails) => void): unknown;
  on(event: 'will-frame-navigate', listener: (event: FrameNavigation) => void): unknown;
}

export interface DocumentPreviewGuard {
  /* Whether a loopback request from this frame may carry the server's token. */
  mayCarryServerToken(frame: GuardedFrame | null | undefined): boolean;
}

/* about:srcdoc, with or without the fragment an in-page link adds to it. */
const SRCDOC_URL = /^about:srcdoc(?:[?#]|$)/;

function isPreviewFrame(frame: GuardedFrame): boolean {
  try {
    return frame.name === PREVIEW_FRAME_NAME;
  } catch {
    return true;
  }
}

function isSrcdocFrame(frame: GuardedFrame): boolean {
  try {
    return SRCDOC_URL.test(frame.url);
  } catch {
    return true;
  }
}

export function guardDocumentPreviewFrames(contents: GuardedContents): DocumentPreviewGuard {
  const previewFrameIds = new Set<number>();

  /* Whether this frame or one of its ancestors is a marked preview frame.
     A parent chain it can't read counts as inside one. */
  const isInPreview = (frame: GuardedFrame): boolean => {
    try {
      for (let current: GuardedFrame | null = frame; current; current = current.parent) {
        if (previewFrameIds.has(current.frameTreeNodeId)) return true;
      }
      return false;
    } catch {
      return true;
    }
  };

  contents.on('frame-created', (_event, { frame }) => {
    if (frame && isPreviewFrame(frame)) previewFrameIds.add(frame.frameTreeNodeId);
  });

  contents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame || event.url === 'about:srcdoc') return;
    if (!event.frame || isSrcdocFrame(event.frame) || isInPreview(event.frame)) event.preventDefault();
  });

  return {
    mayCarryServerToken: (frame) => !!frame && !isInPreview(frame),
  };
}
