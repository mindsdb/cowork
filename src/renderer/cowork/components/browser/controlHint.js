/* The browser pane header's hint, on the desktop and the web alike: who
   holds the browser, and what hands it over. */

/* Where the page is, as the browser reads it: an http(s) page's host, else
   its scheme and path (about:blank). Never text the page chooses, such as
   its title or an address's query or fragment: a fragment changes in place,
   with no navigation the app checks. */
export function siteOf(url) {
  try {
    const { protocol, host: name, pathname } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? name : `${protocol}${pathname}`;
  } catch {
    return '';
  }
}

/**
 * The hint for who holds the browser: the agent, with Take over to use it,
 * or the person, on the page's site and with the agent's reason when it gave
 * one, until Done hands it back. A hand-over that comes back by itself once
 * the person did what it waits for (a box ticked, a page moved on) says so;
 * Done still works.
 *
 * @param {(key: string, vars?: Record<string, unknown>) => string} t  The chat namespace's t.
 * @param {{ holder?: string, reason?: string, watching?: boolean, url?: string, agentLabel: string }} control
 *   `holder` is 'human' while the person holds the browser; `watching` is true while the
 *   hand-over waits for something on the page; `url` is the page it shows.
 * @returns {string}
 */
export function controlHint(t, { holder, reason = '', watching = false, url = '', agentLabel }) {
  if (holder !== 'human') return t('browser.agentUsing', { agent: agentLabel });
  // The page's own host leads the agent's reason, so a lookalike page can't
  // pass its words off as the app's.
  const site = siteOf(url) || t('browser.aNewTab');
  if (reason && watching) return t('browser.yourTurnWatching', { site, reason, agent: agentLabel });
  return reason
    ? t('browser.yourTurnReason', { site, reason, agent: agentLabel })
    : t('browser.yourTurn', { site, agent: agentLabel });
}
