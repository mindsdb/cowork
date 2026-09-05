// Use prism-async-light with explicit languages to limit bundle size.

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

export function CodeBlock({ code = '', language = 'python', maxHeight = 360 }) {
  const theme = useBodyTheme();
  const palette = theme === 'dark' ? vscDarkPlus : oneLight;
  // Override the highlighter background with the app surface token.
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
      codeTagProps={{ style: { fontFamily: 'var(--font-mono)' } }}
      wrapLongLines={false}
    >
      {code}
    </Prism>
  );
}
