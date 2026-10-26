/*
 * The document preview harness page. It exposes window.coworkPreviewHarness,
 * whose open(set, file) fetches one fixture, reads it with the parent's byte
 * cap, and mounts the real DocumentPreviewFrame with that set's bundle: the
 * test-only navigation bundle for 'navigation', and the app's generated
 * registry for a document type. It resolves with the frame's outcome, and the
 * frame stays mounted until the next open(), unless the watchdog removed it.
 */
import { createRoot } from 'react-dom/client';
import navigationBundle from 'virtual:navigation-preview-bundle';

import type { DocumentPreviewType } from '../../src/renderer/cowork/preview/contract';
import { DocumentPreviewFrame } from '../../src/renderer/cowork/preview/DocumentPreviewFrame';
import { previewBundles } from '../../src/renderer/cowork/preview/generated/registry';
import { PREVIEW_PARENT_LIMITS } from '../../src/renderer/cowork/preview/limits';
import { loadPreviewBundle, type LoadedPreviewBundle } from '../../src/renderer/cowork/preview/runtime/bundle';
import { isPreviewError } from '../../src/renderer/cowork/preview/errors';
import { readPreviewBytes } from '../../src/renderer/cowork/preview/runtime/readBytes';
import type { HarnessOutcome, PreviewFixtureSet } from './harness';

interface SetBundle {
  previewType: DocumentPreviewType;
  bundle: LoadedPreviewBundle;
}

const root = createRoot(document.getElementById('root')!);
let mountCount = 0;

async function setBundle(set: PreviewFixtureSet): Promise<SetBundle> {
  if (set === 'navigation') {
    const { type, scriptText, scriptSha256 } = navigationBundle;
    return { previewType: type, bundle: { scriptText, scriptSha256, assets: null } };
  }
  const bundle = await loadPreviewBundle(previewBundles, set);
  if (!bundle) throw new Error(`This build has no ${set} renderer (renderers/${set}/render.ts).`);
  return { previewType: set, bundle };
}

async function open(set: PreviewFixtureSet, file: string): Promise<HarnessOutcome> {
  root.render(null);
  const response = await fetch(`/fixtures/${set}/${file}`);
  if (!response.ok) throw new Error(`No fixture at /fixtures/${set}/${file} (${response.status}).`);
  let bytes: ArrayBuffer;
  try {
    bytes = await readPreviewBytes(response, PREVIEW_PARENT_LIMITS.maxBytes, new AbortController().signal);
  } catch (error) {
    if (isPreviewError(error)) return { outcome: 'error', errorCode: error.code, ...(error.limit ? { errorLimit: error.limit } : {}) };
    throw error;
  }
  const { previewType, bundle } = await setBundle(set);
  mountCount += 1;
  return new Promise((resolve) => {
    root.render(
      <DocumentPreviewFrame
        key={mountCount}
        previewType={previewType}
        bytes={bytes}
        bundle={bundle}
        title={`Preview of ${file}`}
        onRendered={(summary) => resolve({ outcome: 'rendered', summary })}
        onError={({ code, limit }) => resolve({ outcome: 'error', errorCode: code, ...(limit ? { errorLimit: limit } : {}) })}
      />,
    );
  });
}

window.coworkPreviewHarness = { open };
