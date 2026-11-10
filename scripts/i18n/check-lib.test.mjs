// node --test scripts/i18n/check-lib.test.mjs   (npm run test:i18n-check)
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCatalogs, compareMessages, findLiterals, flattenCatalogs, hash, updateLock } from './check-lib.mjs';

const kinds = (issues) => issues.map((i) => `${i.kind} ${i.locale} ${i.key}`).sort();

function locked(catalogs) {
  return updateLock(catalogs, {});
}

test('flattens nested catalogs into namespaced keys', () => {
  assert.deepEqual(flattenCatalogs({ settings: { nav: { title: 'Settings' }, ok: 'OK' } }), {
    'settings:nav.title': 'Settings',
    'settings:ok': 'OK',
  });
});

test('a complete, locked set of catalogs passes', () => {
  const catalogs = { en: { 'a:x': 'Hi {name}' }, es: { 'a:x': 'Hola {name}' } };
  assert.deepEqual(checkCatalogs(catalogs, locked(catalogs)).issues, []);
});

test('finds missing and extra keys', () => {
  const catalogs = { en: { 'a:x': 'One', 'a:y': 'Two' }, es: { 'a:x': 'Uno', 'a:z': 'Tres' } };
  const { issues } = checkCatalogs(catalogs, locked(catalogs));
  assert.deepEqual(kinds(issues), ['extra es a:z', 'missing es a:y']);
});

test('finds renamed or dropped arguments', () => {
  assert.match(compareMessages('Hi {name}', 'Hola {nombre}')[0], /arguments differ/);
  assert.match(compareMessages('{count, plural, one {# task} other {# tasks}}', '{count} tareas')[0], /arguments differ/);
});

test('allows different plural categories but requires other', () => {
  assert.deepEqual(
    compareMessages('{n, plural, one {# task} other {# tasks}}', '{n, plural, one {# tarea} many {# de tareas} other {# tareas}}'),
    [],
  );
  assert.match(compareMessages('{n, plural, one {# task} other {# tasks}}', '{n, plural, one {# tarea}}')[0], /MISSING_OTHER_CLAUSE|no "other"/);
});

test('requires the same select branches', () => {
  const problems = compareMessages('{kind, select, file {File} other {Item}}', '{kind, select, archivo {Archivo} other {Elemento}}');
  assert.match(problems.join(), /branches differ/);
});

test('reports invalid ICU in a translation', () => {
  const catalogs = { en: { 'a:x': 'Hi {name}' }, es: { 'a:x': 'Hola {name' } };
  const { issues } = checkCatalogs(catalogs, locked(catalogs));
  assert.deepEqual(kinds(issues), ['invalid es a:x']);
});

test('a translation the lock has never seen is unlocked', () => {
  const catalogs = { en: { 'a:x': 'Hi' }, es: { 'a:x': 'Hola' } };
  assert.deepEqual(kinds(checkCatalogs(catalogs, {}).issues), ['unlocked es a:x']);
});

test('changing English makes the translation stale, and writing the lock does not hide it', () => {
  const before = { en: { 'a:x': 'Delete task' }, es: { 'a:x': 'Eliminar tarea' } };
  const lock = locked(before);
  const after = { en: { 'a:x': 'Delete task and its files' }, es: { 'a:x': 'Eliminar tarea' } };
  assert.deepEqual(kinds(checkCatalogs(after, lock).issues), ['stale es a:x']);

  const rewritten = updateLock(after, lock);
  assert.deepEqual(kinds(checkCatalogs(after, rewritten).issues), ['stale es a:x']);
});

test('retranslating clears the staleness on the next lock write', () => {
  const lock = locked({ en: { 'a:x': 'Delete task' }, es: { 'a:x': 'Eliminar tarea' } });
  const retranslated = { en: { 'a:x': 'Delete task and its files' }, es: { 'a:x': 'Eliminar la tarea y sus archivos' } };
  assert.deepEqual(checkCatalogs(retranslated, updateLock(retranslated, lock)).issues, []);
});

test('--accept re-stamps a translation that is still right', () => {
  const lock = locked({ en: { 'a:x': 'Colour' }, es: { 'a:x': 'Color' } });
  const after = { en: { 'a:x': 'Color' }, es: { 'a:x': 'Color' } };
  assert.deepEqual(checkCatalogs(after, updateLock(after, lock, { accept: ['a:x'] })).issues, []);
  assert.deepEqual(checkCatalogs(after, updateLock(after, lock, { accept: ['a:'] })).issues, []);
});

test('the lock drops keys English no longer has', () => {
  const lock = locked({ en: { 'a:x': 'X', 'a:y': 'Y' }, es: { 'a:x': 'X', 'a:y': 'Y' } });
  assert.deepEqual(Object.keys(updateLock({ en: { 'a:x': 'X' }, es: { 'a:x': 'X' } }, lock)), ['a:x']);
  assert.equal(lock['a:x'].es.from, hash('X'));
});

test('finds English hard-coded in JSX text and readable attributes', () => {
  const source = [
    '<Section title="Sidebar logo" subtitle={t(\'x\')}>',
    '  <span>Changes are saved automatically.</span>',
    '  <Button aria-label={t(\'remove\')}>{t(\'remove\')}</Button>',
    '  // <span>Commented Out text</span>',
    '  <img alt="" className="Big Box" />',
    '</Section>',
  ].join('\n');
  assert.deepEqual(findLiterals(source).map((h) => h.text), ['Sidebar logo', 'Changes are saved automatically.']);
});

test('skips allowlisted names', () => {
  assert.deepEqual(findLiterals('<span>MindsHub Cowork</span>', new Set(['MindsHub Cowork'])), []);
});
