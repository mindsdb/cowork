import { afterEach, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomeView from './HomeView';
import { changeLocale } from '../../lib/i18n';

// The stock greeting is the first thing people see: with none set, it follows
// the UI language. A greeting someone typed is shown as typed.
afterEach(async () => {
  await changeLocale('en');
});

it('shows the default greeting in the UI language when none is set', async () => {
  await changeLocale('es');
  render(<HomeView greeting={null} activeTasks={[]} skipIntro serverOnline configReady />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Vamos a tachar algo de tu lista');
});

it('shows a custom greeting as typed, whatever the UI language', async () => {
  await changeLocale('es');
  render(<HomeView greeting="Welcome to Acme" activeTasks={[]} skipIntro serverOnline configReady />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome to Acme');
});
