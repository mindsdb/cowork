import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureConsoleHandoff, takeConsoleHandoff, findSample, sampleId, isUntouchedSample,
} from './consoleHandoff';
import { OWN_WORK_PROMPT } from '../components/onboarding/steps';

const at = (search, pathname = '/') => ({ search, pathname, hash: '' });

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('console handoff', () => {
  // The console links to these ids, from Home and from the Gallery's use cases
  // and features. Renaming a label changes its id and breaks that link, which
  // opens an empty composer.
  it.each([
    ['games', 'classic-snake-game', 'Classic snake game'],
    ['games', 'celestial-merge-2048', 'Celestial merge 2048'],
    ['visualization', 'track-monthly-kpis-across-departments', 'Track monthly KPIs across departments'],
    ['apps', 'build-a-quote-or-invoice-generator', 'Build a quote or invoice generator'],
    ['apps', 'build-study-planning-and-progress-tool', 'Build study planning and progress tool'],
    ['website', 'build-a-landing-page-for-a-product-launch', 'Build a landing page for a product launch'],
    ['spreadsheet', 'clean-up-my-spreadsheet-and-chart-it', 'Clean up my spreadsheet and chart it'],
    ['spreadsheet', 'compile-a-north-america-ai-conference-calendar', 'Compile a North America AI conference calendar'],
    ['wide-research', 'summarize-a-document-and-draft-my-reply', 'Summarize a document and draft my reply'],
    ['website', 'build-a-project-status-page', 'Build a project status page'],
    ['website', 'build-a-team-offsite-invitation-page', 'Build a team offsite invitation page'],
    ['website', 'build-a-feature-announcement-page', 'Build a feature announcement page'],
  ])('resolves %s/%s, which the console links to', (mode, id, label) => {
    expect(findSample(mode, id)?.sample.label).toBe(label);
  });

  it('keeps the console placement it knows, so the task can be credited to it', () => {
    window.history.replaceState(null, '', '/?from=console&mode=games&sample=celestial-merge-2048&placement=gallery');
    captureConsoleHandoff(at('?from=console&mode=games&sample=celestial-merge-2048&placement=gallery'));

    expect(window.location.search).toBe('');
    expect(takeConsoleHandoff()).toMatchObject({ entrySource: 'console', placement: 'gallery' });
  });

  it('drops a placement it does not know instead of storing it', () => {
    captureConsoleHandoff(at('?from=console&mode=games&sample=classic-snake-game&placement=<script>'));
    expect(window.sessionStorage.getItem('anton.consoleHandoff')).not.toContain('script');
    expect(takeConsoleHandoff().placement).toBeNull();
  });

  it('survives the login round trip: captured before the redirect, taken after it', () => {
    window.history.replaceState(null, '', '/?from=console&mode=games&sample=classic-snake-game');
    captureConsoleHandoff(at('?from=console&mode=games&sample=classic-snake-game'));
    // Keycloak returns to the bare pathname; capture on that load must not erase the stash.
    captureConsoleHandoff(at(''));

    const handoff = takeConsoleHandoff();
    expect(handoff.entrySource).toBe('console');
    expect(handoff.mode.id).toBe('games');
    expect(sampleId(handoff.sample.label)).toBe('classic-snake-game');
  });

  it('applies once', () => {
    captureConsoleHandoff(at('?from=console&mode=games&sample=classic-snake-game'));
    expect(takeConsoleHandoff()).not.toBeNull();
    expect(takeConsoleHandoff()).toBeNull();
  });

  it('strips its params from the address bar and keeps any others', () => {
    window.history.replaceState(null, '', '/?from=console&mode=games&sample=classic-snake-game&ci=1');
    captureConsoleHandoff(at('?from=console&mode=games&sample=classic-snake-game&ci=1'));
    expect(window.location.search).toBe('?ci=1');
  });

  it('degrades an unknown sample to an empty composer instead of storing it', () => {
    captureConsoleHandoff(at('?from=console&mode=games&sample=<script>'));
    expect(window.sessionStorage.getItem('anton.consoleHandoff')).not.toContain('script');
    expect(takeConsoleHandoff()).toEqual({ entrySource: 'console', mode: null, sample: null, start: null, placement: null });
  });

  it('carries the own-work start, which names the first onboarding step and no text', () => {
    captureConsoleHandoff(at('?from=console&start=own-work'));
    expect(takeConsoleHandoff()).toEqual({ entrySource: 'console', mode: null, sample: null, start: 'own-work', placement: null });
  });

  it('drops a start it does not know instead of storing it', () => {
    captureConsoleHandoff(at('?from=console&start=<script>'));
    expect(window.sessionStorage.getItem('anton.consoleHandoff')).not.toContain('script');
    expect(takeConsoleHandoff().start).toBeNull();
  });

  it('prefers a sample over a start when a link names both', () => {
    captureConsoleHandoff(at('?from=console&mode=games&sample=classic-snake-game&start=own-work'));
    const handoff = takeConsoleHandoff();
    expect(sampleId(handoff.sample.label)).toBe('classic-snake-game');
    expect(handoff.start).toBeNull();
  });

  it('strips the start param from the address bar too', () => {
    window.history.replaceState(null, '', '/?from=console&start=own-work&ci=1');
    captureConsoleHandoff(at('?from=console&start=own-work&ci=1'));
    expect(window.location.search).toBe('?ci=1');
  });

  it('reads a handoff stored without a start, as older tabs wrote it', () => {
    window.sessionStorage.setItem('anton.consoleHandoff', JSON.stringify({
      entrySource: 'console', modeId: null, sampleId: null, at: Date.now(),
    }));
    expect(takeConsoleHandoff()).toEqual({ entrySource: 'console', mode: null, sample: null, start: null, placement: null });
  });

  it('ignores links that are not from the console', () => {
    captureConsoleHandoff(at('?mode=games&sample=classic-snake-game'));
    expect(takeConsoleHandoff()).toBeNull();
  });

  it('expires a handoff abandoned mid-login', () => {
    captureConsoleHandoff(at('?from=console&mode=games&sample=classic-snake-game'));
    expect(takeConsoleHandoff(window.sessionStorage, Date.now() + 11 * 60 * 1000)).toBeNull();
  });

  it('treats the own-work prompt as text the app placed, not the person\'s own', () => {
    expect(isUntouchedSample(OWN_WORK_PROMPT)).toBe(true);
    expect(isUntouchedSample(`${OWN_WORK_PROMPT} Also my notes.`)).toBe(false);
  });
});
