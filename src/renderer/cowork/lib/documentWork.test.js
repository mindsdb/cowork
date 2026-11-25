import { afterEach, beforeEach, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';

import { __resetWorkStartedForTests, hasWorkStarted } from './documentWork';

beforeEach(() => __resetWorkStartedForTests());
afterEach(() => { document.body.innerHTML = ''; });

function field(html) {
  document.body.innerHTML = html;
  return document.body.firstElementChild;
}

// No composer has to opt in: one that keeps its text in plain component state
// is covered the same as one backed by the draft store.
it.each([
  ['a textarea', '<textarea></textarea>'],
  ['a text input', '<input type="text">'],
  ['an editable region', '<div contenteditable="true"></div>'],
])('counts typing into %s as work started', (_name, html) => {
  fireEvent.input(field(html));
  expect(hasWorkStarted()).toBe(true);
});

it('does not count ticking a box', () => {
  fireEvent.input(field('<input type="checkbox">'));
  expect(hasWorkStarted()).toBe(false);
});
