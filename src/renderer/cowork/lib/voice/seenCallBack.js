// The voice call's one call back, which waits for the person to see the tab:
// in a tab out of sight the call would start unheard. It carries the news of
// work the call gave Anton: a result, or a request he stopped on the person
// for (lib/voice/callNeeds.js). News that comes while it waits goes into the
// same call back, so each is said, oldest first.

/**
 * One piece of news for the call back. `asks`: Anton stopped to ask the person
 * something, said as what he needs. `due`: whether it is still worth saying
 * once the tab shows (a request answered on screen meanwhile is not).
 *
 * @typedef {{ asks?: boolean, due?: () => boolean }} CallBackNews
 */

/**
 * @param {{
 *   announce: (news: string, options: { asks: boolean }) => boolean,
 *   canCallBack: () => boolean,
 *   take: () => void,
 *   callBack: (news: string, options: { asks: boolean }) => void,
 *   doc?: Document | undefined,
 * }} deps `announce` says it on a call that is up (a call started meanwhile);
 *   `take` takes the call back the hung-up call left armed, right before
 *   `callBack` starts it.
 */
export function createSeenCallBack({
  announce, canCallBack, take, callBack, doc = typeof document === 'undefined' ? undefined : document,
}) {
  /** The news a call back waits to say, oldest first; null while none waits. */
  let waiting = null;
  const entry = (news, { asks = false, due = () => true } = {}) => ({ news, asks, due });
  return {
    /**
     * Takes `news` into the call back that waits for the tab. False when
     * none waits.
     *
     * @param {string} news
     * @param {CallBackNews} [options]
     * @returns {boolean}
     */
    join(news, options) {
      if (!waiting) return false;
      waiting.push(entry(news, options));
      return true;
    },
    /**
     * Calls back with `news` now, or once the tab is in sight, with whatever
     * joined it meanwhile and is still due.
     *
     * @param {string} news
     * @param {CallBackNews} [options]
     */
    callBack(news, options) {
      const first = entry(news, options);
      if (!doc || doc.visibilityState !== 'hidden') {
        take();
        callBack(first.news, { asks: first.asks });
        return;
      }
      const said = [first];
      waiting = said;
      const onVisible = () => {
        if (doc.visibilityState !== 'visible') return;
        doc.removeEventListener('visibilitychange', onVisible);
        if (waiting === said) waiting = null;
        const due = said.filter((e) => e.due());
        // Nothing left to say: the call back stays armed for what comes next.
        if (!due.length) return;
        const all = due.map((e) => e.news).join('\n');
        const asks = due.some((e) => e.asks);
        // A call started meanwhile hears it; otherwise call back if it still may.
        if (announce(all, { asks })) return;
        if (!canCallBack()) return;
        take();
        callBack(all, { asks });
      };
      doc.addEventListener('visibilitychange', onVisible);
    },
  };
}
