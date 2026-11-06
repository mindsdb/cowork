import { useEffect, useState } from 'react';
import { fetchBrowseStatus } from '../api';

/**
 * Whether this deployment offers the shared browser to this person now:
 * GET /browse/status answers `available: true`. False until the answer comes,
 * and on any failure, so nothing offers the browser by default.
 *
 * `askAgain` is any value whose change asks again: the server coming up, an
 * organization switch, or the desktop's own browser registering with the
 * local server, which can land after the first answer.
 *
 * @param {unknown} askAgain
 * @returns {boolean}
 */
export function useBrowseAvailable(askAgain) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let live = true;
    fetchBrowseStatus().then(
      (status) => { if (live) setAvailable(status?.available === true); },
      () => { if (live) setAvailable(false); },
    );
    return () => { live = false; };
  }, [askAgain]);
  return available;
}
