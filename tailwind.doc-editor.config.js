/** @type {import('tailwindcss').Config} */
//
// Tailwind for the editor on a shared doc's page (npm run build:doc-editor,
// via @config in src/renderer/doc-web/doc-web.css): the app's theme, but only
// the utilities the editor's own files use, not the whole app's.
import app from './tailwind.config.js';

export default {
  ...app,
  content: [
    './src/renderer/doc-web/**/*.{js,jsx}',
    './src/renderer/cowork/components/doc/**/*.{js,jsx}',
    './src/renderer/cowork/components/ui/**/*.{js,jsx,ts,tsx}',
  ],
};
