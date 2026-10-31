/*
 * How typed and pasted addresses become recipients in `<RecipientField>`.
 *
 * Each address becomes a person when the org has that exact email in the
 * loaded directory, else an outside email when allowed, else it is reported
 * with the reason (`notAdded`). Until the directory has loaded nothing is
 * added, so a member is never taken for an outside address: the text stays
 * in the input, held (`held`) while the directory loads, and left for a Retry
 * if it failed.
 *
 * An address a directory over a minute old doesn't have is held while it is
 * read again, once, and one a truncated directory doesn't have while
 * MindsHub is asked about it, once (useOrgDirectory's `refresh` and
 * `lookUp`). If either can't answer, the address stays in the input, never
 * taken for an outside email nor called "not in" the org, and is reported
 * with why MindsHub gave no answer (`failure`, `lookupFailure`). One
 * cowork-server refused as malformed is reported as not an email.
 *
 * The directory leaves out the person signed in, so their own address
 * (`ownEmail`) is refused as "that's you" rather than taken for an outside
 * one.
 *
 * The field owns its input: `showText` puts text in it (and clears the
 * highlighted row), and `reopen` opens the menu again when the input has the
 * focus. `latest` and `emit` are the field's running value and its change.
 */

import { useEffect, useState } from 'react';
import { isEmailShaped } from '../lib/emailAddress';
import { mindsHubFailureText } from '../lib/orgSharing';
import { LOAD_STATUS } from '../lib/sharingContract';
import { DIRECTORY_MAX_AGE_MS, directoryAnswered } from './useOrgSharing';

const NO_PEOPLE = Object.freeze([]);

/**
 * @param {{
 *   directory: ReturnType<typeof import('./useOrgSharing').useOrgDirectory>,
 *   emailsOnly: boolean,
 *   allowExternal: boolean,
 *   ownEmail: string,
 *   org: string,
 *   latest: { current: { teamIds: string[], userIds: string[], emails: string[] } },
 *   emit: (patch: { userIds?: string[], emails?: string[] }) => void,
 *   remember: (people: object[]) => void,
 *   showText: (text: string) => void,
 *   reopen: () => void,
 * }} args
 */
export function useRecipientTokens({
  directory, emailsOnly, allowExternal, ownEmail, org, latest, emit, remember, showText, reopen,
}) {
  const [notAdded, setNotAdded] = useState([]);
  // Addresses typed or pasted before the directory loaded, or while it is
  // read again, held (their text left in the input) until it can say who is
  // in the org: `{ tokens, refreshed, lookedUp }`, `refreshed` once a fresh
  // copy was asked for them and `lookedUp` once MindsHub was, so each is
  // asked only once.
  const [held, setHeld] = useState(null);

  const directoryReady = directory.status === LOAD_STATUS.READY;
  // Too old to say an address isn't in the org without reading it again.
  const directoryStale = directoryReady && Date.now() - (directory.loadedAt || 0) > DIRECTORY_MAX_AGE_MS;
  const directoryPeople = directoryReady ? directory.people : NO_PEOPLE;

  const isOwnEmail = (email) => !emailsOnly && !!ownEmail && email === ownEmail;
  // An address cowork-server refused as malformed is no email at all.
  const isMalformed = (email) => directoryReady && Object.hasOwn(directory.malformed, email);
  const isEmail = (email) => isEmailShaped(email) && !isMalformed(email);
  const findByEmail = (email) => directoryPeople.find((p) => (p.email || '').toLowerCase() === email)
    || (directoryReady && directory.addresses[email]) || null;
  /* Whether "nobody in the org has `email`" is known yet (`matched` is the
     member found for it, if any). Not from a directory over a minute old,
     which `resolve` reads again before trusting a miss, nor from a truncated
     one, past whose end only a lookup can say. */
  const isAnswered = (email, matched) => directoryReady && !directoryStale
    && (!directory.truncated || !!matched || directoryAnswered(directory, email));

  const holdTokens = (tokens, checks) => {
    showText(tokens.join(' '));
    setNotAdded([]);
    setHeld({ tokens, ...checks });
  };

  /** Adds each of `tokens` as the directory says, or holds them until it can. */
  const resolve = (tokens, { refreshed = false, lookedUp = false } = {}) => {
    if (!emailsOnly && (!directoryReady || directory.refreshing || directory.lookingUp)) {
      if (directory.status === LOAD_STATUS.ERROR) {
        showText(tokens.join(' '));
        setNotAdded([]);
        reopen();
      } else {
        holdTokens(tokens, { refreshed, lookedUp });
      }
      return;
    }
    const unmatched = (raw) => {
      const email = raw.toLowerCase();
      return isEmail(email) && !isOwnEmail(email) && !findByEmail(email);
    };
    if (!emailsOnly && !refreshed && directoryStale && tokens.some(unmatched)) {
      // The new read drops MindsHub's answers, so they are asked for again.
      holdTokens(tokens, { refreshed: true, lookedUp: false });
      directory.refresh();
      return;
    }
    // A fresh copy was asked for and the directory is still old: that read
    // failed. An address the old copy lacks may belong to someone who joined
    // since, so it is neither taken for an outside email nor called "not in"
    // the org. It stays in the input, and Enter checks it again.
    const refreshFailed = !emailsOnly && refreshed && directoryStale;
    /* Past a truncated directory's end, only MindsHub can say whose an
       address is. One it couldn't be asked about stays in the input the same
       way. */
    const unanswered = !emailsOnly && !refreshFailed && directory.truncated
      ? tokens.filter((raw) => unmatched(raw) && !directoryAnswered(directory, raw.toLowerCase()))
      : [];
    if (unanswered.length && !lookedUp) {
      holdTokens(tokens, { refreshed, lookedUp: true });
      directory.lookUp(unanswered.map((raw) => raw.toLowerCase()));
      return;
    }
    const unchecked = refreshFailed ? tokens.filter(unmatched) : unanswered;
    setHeld(null);
    showText(unchecked.join(' '));
    const notInOrg = `not in ${org}`;
    const answers = tokens.filter((raw) => !unchecked.includes(raw)).map((raw) => {
      const email = raw.toLowerCase();
      if (!isEmail(email)) return { raw, reason: 'not an email' };
      if (isOwnEmail(email)) return { raw: email, reason: "that's you" };
      if (emailsOnly) return { email };
      const person = findByEmail(email);
      if (person) return { person };
      if (allowExternal) return { email };
      return { raw: email, reason: notInOrg };
    });
    const next = { ...latest.current, userIds: [...latest.current.userIds], emails: [...latest.current.emails] };
    const people = [];
    const refused = [];
    for (const answer of answers) {
      if (answer.person) {
        people.push(answer.person);
        if (!next.userIds.includes(answer.person.id)) next.userIds.push(answer.person.id);
      } else if (answer.email) {
        if (!next.emails.includes(answer.email)) next.emails.push(answer.email);
      } else {
        refused.push(answer);
      }
    }
    if (people.length) remember(people);
    if (next.userIds.length !== latest.current.userIds.length || next.emails.length !== latest.current.emails.length) {
      emit({ userIds: next.userIds, emails: next.emails });
    }
    const uncheckedReason = mindsHubFailureText(refreshFailed ? directory.failure : directory.lookupFailure, {
      unreachable: `couldn't check who is in ${org}, try again`,
      refused: `MindsHub refused to check who is in ${org}`,
      throttled: 'MindsHub is limiting requests, try again in a minute',
    });
    setNotAdded([...refused, ...unchecked.map((raw) => ({ raw: raw.toLowerCase(), reason: uncheckedReason }))]);
  };

  // The held addresses resolve once the directory answers; a failure leaves
  // them in the input with the directory's Retry.
  useEffect(() => {
    if (!held) return;
    if (directory.status === LOAD_STATUS.READY && !directory.refreshing && !directory.lookingUp) {
      resolve(held.tokens, { refreshed: held.refreshed, lookedUp: held.lookedUp });
    } else if (directory.status === LOAD_STATUS.ERROR) setHeld(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directory.status, directory.refreshing, directory.lookingUp, held]);

  return {
    directoryReady,
    directoryStale,
    directoryPeople,
    isEmail,
    isOwnEmail,
    findByEmail,
    isAnswered,
    resolve,
    held,
    /** Drops what is held, once the person edits the input. */
    release: () => setHeld(null),
    notAdded,
    clearNotAdded: () => setNotAdded([]),
  };
}

export default useRecipientTokens;
