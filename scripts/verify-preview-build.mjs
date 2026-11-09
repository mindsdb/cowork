/*
 * Checks a renderer build output after the build: it must carry the document
 * preview notices file that scripts/preview-bundles.mjs wrote, byte for byte.
 * The package.json postbuild:renderer and postbuild:web hooks run it on
 * dist/renderer and dist/renderer-web.
 *
 *   node scripts/verify-preview-build.mjs <build output folder>
 */
import path from 'node:path';

import { NOTICES_FILE, verifyBuildNotices } from './preview-bundles.mjs';

const [buildDir] = process.argv.slice(2);
if (!buildDir) throw new Error('usage: node scripts/verify-preview-build.mjs <build output folder>');
verifyBuildNotices(path.resolve(buildDir));
console.log(`preview build: ${path.join(buildDir, NOTICES_FILE)} matches the generated notices`);
