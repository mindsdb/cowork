// The docs UI in a language other than English: the other tests run in English.
import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { changeLocale } from '../../../lib/i18n';
import { dayLabel, timeLabel, whenPhrase, whenTitle } from './versionHistory';
import { slashItems } from './canvasOps';
import { blockMenu } from './blockMenu';
import { formatDate, inlineToHtml } from './docModel';
import { VersionBanner } from './DocVersions';

const now = new Date(2026, 10, 17, 15, 0); // a Tuesday
const at = (day, hour = 9) => new Date(2026, 10, day, hour, 4).toISOString();

afterEach(async () => {
  await changeLocale('en');
});

describe('version times', () => {
  it('read as one phrase in the app language, for each kind of day', async () => {
    await changeLocale('de');
    expect(whenPhrase(at(17), now)).toBe(`heute um ${timeLabel(at(17))}`);
    expect(whenPhrase(at(16), now)).toBe(`gestern um ${timeLabel(at(16))}`);
    expect(whenPhrase(at(12), now)).toBe(`am Donnerstag um ${timeLabel(at(12))}`);
  });

  it('capitalize a weekday that heads a day', async () => {
    await changeLocale('es');
    expect(dayLabel(at(12), now)).toBe('Jueves');
    expect(whenPhrase(at(12), now)).toBe(`el jueves a las ${timeLabel(at(12))}`);
  });

  it('keep the version time bold wherever the language puts it', async () => {
    await changeLocale('ko');
    const history = { preview: { entry: { at: at(17), by: 'user', summary: 'Edited' } }, canStep: {} };
    const { container } = render(<VersionBanner history={history} now={now} />);
    const title = container.querySelector('.doc-version-bar__title');
    expect(title.querySelector('b').textContent).toBe(whenTitle(at(17), now));
    expect(title.textContent.startsWith(`${whenTitle(at(17), now)} 버전 보는 중`)).toBe(true);
  });
});

describe('block menus', () => {
  it('follow a language switch', async () => {
    const turnInto = () => blockMenu([{ id: 'b_1', type: 'paragraph', text: 'Hi' }], 0)[0];
    await changeLocale('de');
    expect(slashItems('', false)[1]).toMatchObject({ label: 'Überschrift 1', group: 'Grundlagen' });
    expect(turnInto()).toMatchObject({ label: 'Umwandeln in', submenu: expect.arrayContaining([expect.objectContaining({ label: 'Überschrift 1' })]) });
    await changeLocale('en');
    expect(slashItems('', false)[1].label).toBe('Heading 1');
  });

  it('find a block by its translated label, and still by its English one', async () => {
    await changeLocale('de');
    expect(slashItems('aufz', false)[0].key).toBe('bullet');
    // "Nummerierte Liste" and "To-do-Liste" match in German; "Aufzählung" only as "Bulleted list", after them.
    expect(slashItems('list', false).map((i) => i.key)).toEqual(['numbered', 'task', 'bullet']);
    expect(slashItems('zzz', false)).toEqual([]);
  });
});

describe('inline values', () => {
  it('show dates and the person in the app language', async () => {
    await changeLocale('de');
    expect(formatDate('2026-10-21')).toMatch(/^21\. Okt\.? 2026$/);
    expect(inlineToHtml('{{user:me}}')).toContain('>Sie</span>');
  });
});
