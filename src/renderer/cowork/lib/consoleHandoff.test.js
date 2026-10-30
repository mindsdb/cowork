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
  // The console links to these ids. Renaming either label breaks those links.
  it('resolves the samples the console links to', () => {
    expect(findSample('games', 'classic-snake-game')?.sample.label).toBe('Classic snake game');
    expect(findSample('visualization', 'track-monthly-kpis-across-departments')?.sample.label)
      .toBe('Track monthly KPIs across departments');
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
    expect(takeConsoleHandoff()).toEqual({ entrySource: 'console', mode: null, sample: null, start: null });
  });

  it('carries the own-work start, which names the first onboarding step and no text', () => {
    captureConsoleHandoff(at('?from=console&start=own-work'));
    expect(takeConsoleHandoff()).toEqual({ entrySource: 'console', mode: null, sample: null, start: 'own-work' });
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
    expect(takeConsoleHandoff()).toEqual({ entrySource: 'console', mode: null, sample: null, start: null });
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
