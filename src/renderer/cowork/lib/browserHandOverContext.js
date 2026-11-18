/* What a hand-over card needs from the chat around it (ChatView provides it):
   the browser it hands back, whether the pane shows it, how to open the pane,
   how to carry on a turn that ended while the person held the browser, and
   how to say the person stopped the task from the card, so nothing carries
   it on.
   A card outside any provider still renders, with Done, continue handing
   back the latest browser it can and opening nothing. */

import { createContext, useContext } from 'react';

/**
 * @typedef {{
 *   sessionId: string | null,
 *   paneShown: boolean,
 *   openBrowser: () => void,
 *   continueTask: (() => void) | null,
 *   stopTask: (() => void) | null,
 *   agentLabel: string,
 * }} BrowserHandOverValue
 */

/** @type {BrowserHandOverValue} */
const NONE = { sessionId: null, paneShown: true, openBrowser: () => {}, continueTask: null, stopTask: null, agentLabel: 'Anton' };

export const BrowserHandOverContext = createContext(NONE);

export const useBrowserHandOver = () => useContext(BrowserHandOverContext);
