// A picture Anton's generate_image tool wrote into the workspace (ENG-4024),
// shown inline in the chat where the tool finished.
//
// The tool hands back the file's path, never its bytes, so the card reads the
// file the way the rest of the chat reads a project file: through the
// project's files route, fetched with the viewer's token and shown from a
// blob: URL (useBlobImageSrc). A direct <img src> would be refused by the
// desktop shell's CSP and would carry no bearer on an org deployment.
//
// A file the card can't read (moved, deleted, outside the project, or not an
// image after all) shows its name and says so, never a broken-image icon.
// Clicking a loaded image opens it in the file viewer, which can save it or,
// on desktop, open it in the default app.

import { useState } from 'react';
import Ico from './Icons';
import { Tooltip } from './ui';
import { useBlobImageSrc } from './AttachmentThumbnail';
import { projectFileDownloadUrl } from '../api';
import { projectRelativeImagePath } from '../lib/generatedImage';

// Wide enough to read a generated picture in the chat column, small enough
// that a turn of several stays scannable. The file viewer shows it full size.
const MAX_EDGE_PX = 360;

/**
 * @param {{
 *   image: { path: string, name: string, width?: number | null, height?: number | null, prompt?: string },
 *   projectName?: string | null,
 *   projectPath?: string,
 *   onOpen?: ((relPath: string) => void) | null,
 * }} props
 */
export function GeneratedImageCard({ image, projectName = null, projectPath = '', onOpen = null }) {
  const relPath = projectRelativeImagePath(image?.path, projectPath);
  const url = relPath && projectName ? projectFileDownloadUrl(projectName, relPath) : null;
  const { src, failed } = useBlobImageSrc({ url });
  // The bytes arrived but don't decode as an image.
  const [undecodable, setUndecodable] = useState(false);
  const name = image?.name || relPath || 'image';
  const alt = image?.prompt || `Generated image ${name}`;
  const width = image?.width || null;
  const height = image?.height || null;
  // With its size known, the frame takes the picture's shape before the bytes
  // land, so the turn doesn't jump; the longer edge gets MAX_EDGE_PX.
  const sized = !!(width && height);
  const frameStyle = !sized
    ? { minWidth: 160, minHeight: 120 }
    : width >= height
      ? { aspectRatio: `${width} / ${height}`, width: `min(${MAX_EDGE_PX}px, 100%)` }
      : { aspectRatio: `${width} / ${height}`, height: MAX_EDGE_PX };
  const imgStyle = sized
    ? { display: 'block', width: '100%', height: '100%', objectFit: 'contain' }
    : { display: 'block', maxWidth: `min(${MAX_EDGE_PX}px, 100%)`, maxHeight: MAX_EDGE_PX, width: 'auto', height: 'auto' };

  if (failed || undecodable) {
    return (
      <div
        className="inline-flex items-center gap-2 max-w-full py-2 px-3 rounded-xl border border-solid border-line bg-surface-2 text-ink-3 text-[12.5px]"
        title={image?.path || undefined}
      >
        <span className="inline-flex flex-none">{Ico.image(16)}</span>
        <span className="min-w-0 truncate">
          <span className="text-ink-2">{name}</span> could not be shown. It may have been moved or deleted.
        </span>
      </div>
    );
  }

  const picture = (
    <span
      className="inline-flex items-center justify-center overflow-hidden rounded-xl border border-solid border-line bg-surface-2 max-w-full"
      style={frameStyle}
    >
      {src ? <img src={src} alt={alt} onError={() => setUndecodable(true)} style={imgStyle} /> : null}
    </span>
  );

  return (
    <figure className="m-0 inline-flex flex-col gap-1 max-w-full">
      {onOpen && relPath && src ? (
        <Tooltip content="Open image">
          <button
            type="button"
            onClick={() => onOpen(relPath)}
            aria-label={`Open image: ${name}`}
            className="p-0 m-0 border-0 bg-transparent cursor-pointer max-w-full text-left"
          >
            {picture}
          </button>
        </Tooltip>
      ) : picture}
      <figcaption className="text-[11.5px] text-ink-4 truncate max-w-[360px]" title={image?.path || undefined}>
        {name}
      </figcaption>
    </figure>
  );
}

export default GeneratedImageCard;
