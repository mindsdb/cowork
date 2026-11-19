/*
 * The entry of every renderer's frame bundle. The bundle generator resolves
 * 'virtual:cowork-preview-renderer' to one renderers/<type>/render.ts per
 * build, so each bundle holds this runtime and exactly one renderer.
 */
import renderer from 'virtual:cowork-preview-renderer';

import { startPreviewFrame } from './frame';

startPreviewFrame(renderer);
