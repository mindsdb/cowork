import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ loadArtifactAudience: vi.fn() }));
vi.mock('../lib/artifactWorkspaceApi', () => api);

import { needsAudience, resetArtifactAudiences, useArtifactAudiences, useArtifactAudiencesState } from './useArtifactAudiences';

// A restricted card in MindsHub mode doesn't say who it reaches; the list
// reads it once and fills it in (ENG-4560).
const UNKNOWN = { orgAllowed: null, allowedTeamIds: null, allowedUserIds: null, accessEmails: null, ownerOnly: null };
const card = (id, extra = {}) => ({
  id, path: `/p/${id}/index.html`, publishedUrl: `https://view.example/r/${id}`, mtime: 5,
  accessMode: 'restricted', ...UNKNOWN, ...extra,
});

afterEach(() => { resetArtifactAudiences(); api.loadArtifactAudience.mockReset(); window.sessionStorage.clear(); });

describe('useArtifactAudiences', () => {
  it('reads only published restricted cards whose audience is unknown', () => {
    expect(needsAudience(card('a'))).toBe(true);
    expect(needsAudience(card('b', { accessMode: 'public' }))).toBe(false);
    expect(needsAudience(card('c', { publishedUrl: '' }))).toBe(false);
    expect(needsAudience(card('d', { orgAllowed: true, allowedTeamIds: [], allowedUserIds: [], accessEmails: [], ownerOnly: false }))).toBe(false);
  });

  it('fills in the audience it read, marked as read, and asks once', async () => {
    api.loadArtifactAudience.mockResolvedValue({
      accessMode: 'restricted', orgAllowed: true, ownerOnly: false, allowedTeamIds: [], allowedUserIds: [], accessEmails: [], names: true,
    });
    const list = [card('a')];
    const { result, rerender } = renderHook(({ items }) => useArtifactAudiences(items), { initialProps: { items: list } });

    await waitFor(() => expect(result.current[0].orgAllowed).toBe(true));
    expect(result.current[0].audienceRead).toBe(true);
    rerender({ items: [...list] });
    expect(api.loadArtifactAudience).toHaveBeenCalledTimes(1);
  });

  it('leaves a card unknown when the answer names nobody (outside the org)', async () => {
    api.loadArtifactAudience.mockResolvedValue({ accessMode: 'restricted', orgAllowed: false, names: false });
    const { result } = renderHook(() => useArtifactAudiences([card('a')]));
    await waitFor(() => expect(api.loadArtifactAudience).toHaveBeenCalled());
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(result.current[0].orgAllowed).toBeNull();
    expect(result.current[0].audienceRead).toBeUndefined();
  });

  // The page waits for every answer before grouping, so cards don't land in
  // Yours and move a moment later (ENG-4585).
  it('is settled once every card has its answer', async () => {
    let answer;
    api.loadArtifactAudience.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const { result } = renderHook(() => useArtifactAudiencesState([card('a'), card('b', { accessMode: 'public' })]));
    expect(result.current.settled).toBe(false);
    answer({ accessMode: 'restricted', orgAllowed: true, ownerOnly: false, allowedTeamIds: [], allowedUserIds: [], accessEmails: [], names: true });
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.list[0].orgAllowed).toBe(true);
  });

  it('settles after a failed read, and does not ask again while open', async () => {
    api.loadArtifactAudience.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useArtifactAudiencesState([card('a')]));
    await waitFor(() => expect(result.current.settled).toBe(true));
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    expect(api.loadArtifactAudience).toHaveBeenCalledTimes(1);
    expect(result.current.list[0].orgAllowed).toBeNull();
  });

  it('is settled at once when off', () => {
    const { result } = renderHook(() => useArtifactAudiencesState([card('a')], { enabled: false }));
    expect(result.current.settled).toBe(true);
  });

  it('reads nothing when off (desktop)', () => {
    const list = [card('a')];
    const { result } = renderHook(() => useArtifactAudiences(list, { enabled: false }));
    expect(result.current).toBe(list);
    expect(api.loadArtifactAudience).not.toHaveBeenCalled();
  });
});
