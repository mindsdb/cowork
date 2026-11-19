// Theme-aware syntax-highlighted code block. Uses prism-async-light so
// only the languages we register get bundled. JetBrains Mono throughout.
//
// Light: oneLight palette. Dark: vscDarkPlus, with our --surface-2
// background substituted in so the block matches the modal chrome.

import { useEffect, useState } from 'react';
import { PrismAsyncLight as Prism } from 'react-syntax-highlighter';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light';
import vscDarkPlus from 'react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus';

Prism.registerLanguage('python', python);
Prism.registerLanguage('javascript', javascript);
Prism.registerLanguage('js', javascript);
Prism.registerLanguage('json', json);
Prism.registerLanguage('bash', bash);
Prism.registerLanguage('shell', bash);
Prism.registerLanguage('sql', sql);

function readBodyTheme() {
  if (typeof document === 'undefined') return 'light';
  return document.body?.dataset?.theme === 'dark' ? 'dark' : 'light';
}

function useBodyTheme() {
  const [theme, setTheme] = useState(readBodyTheme);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const obs = new MutationObserver(() => setTheme(readBodyTheme()));
    obs.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

/* `wrap` breaks long lines, anywhere in a long token too, instead of
   scrolling them sideways: for one-line text such as a request's URL, where
   the line breaks of code carry no meaning. */
export function CodeBlock({ code = '', language = 'python', maxHeight = 360, wrap = false }) {
  const theme = useBodyTheme();
  const palette = theme === 'dark' ? vscDarkPlus : oneLight;
  // Override the highlighter's default block bg so the code panel
  // sits on our token surface (and the rounded corners come from us).
  const customStyle = {
    margin: 0,
    padding: '12px 14px',
    background: 'var(--surface-2)',
    fontFamily: 'var(--font-mono)',
    fontSize: 12.5,
    lineHeight: 1.5,
    maxHeight,
    overflow: 'auto',
    borderRadius: 0,
  };
  return (
    <Prism
      language={language}
      style={palette}
      customStyle={customStyle}
      codeTagProps={{ style: wrap ? { fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' } : { fontFamily: 'var(--font-mono)' } }}
      wrapLongLines={wrap}
    >
      {code}
    </Prism>
  );
}
