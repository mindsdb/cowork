// The owner's name in the "whose is this" marker (ENG-4455): named through
// the MindsHub people lookup the Share panel uses, "Another member" until
// then and when MindsHub can't name them, and one lookup for a whole list.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen, waitFor } from '@testing-library/react';

const people = vi.hoisted(() => ({ byIds: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchMindsHubPeopleByIds: people.byIds,
}));

import {
  ArtifactOwnerNamesProvider,
  artifactOwnerIds,
  useArtifactAuthorship,
  useArtifactAuthorships,
} from './useArtifactAuthorship';
import { OTHER_ACTOR_LABEL } from '../lib/sharedResourceAccess';

const DIRECTORY = [
  { id: 'u-ana', name: 'Ana Ruiz', email: 'ana@acme.com' },
  { id: 'u-bo', name: '', email: 'bo@acme.com' },
];
const ANA_CAPS = { role: 'reviewer', canEdit: false, ownerUserId: 'u-ana' };

beforeEach(() => {
  people.byIds.mockReset();
  people.byIds.mockImplementation(async (ids) => ({
    reachable: true,
    people: DIRECTORY.filter((p) => ids.includes(p.id)),
  }));
});

describe('useArtifactAuthorship', () => {
  it('names the owner once MindsHub answers', async () => {
    const { result } = renderHook(() => useArtifactAuthorship(ANA_CAPS));
    expect(result.current.label).toBe(OTHER_ACTOR_LABEL);
    await waitFor(() => expect(result.current.label).toBe('Ana Ruiz'));
    expect(people.byIds).toHaveBeenCalledWith(['u-ana']);
  });

  it('falls back to the email when MindsHub has no name', async () => {
    const { result } = renderHook(() => useArtifactAuthorship({ role: 'reviewer', ownerUserId: 'u-bo' }));
    await waitFor(() => expect(result.current.label).toBe('bo@acme.com'));
  });

  it('keeps "Another member" when MindsHub can\'t be asked', async () => {
    people.byIds.mockImplementation(async () => ({ reachable: false, failure: 'mindshub_unreachable', people: [] }));
    const { result } = renderHook(() => useArtifactAuthorship(ANA_CAPS));
    await waitFor(() => expect(people.byIds).toHaveBeenCalled());
    await Promise.resolve();
    expect(result.current.label).toBe(OTHER_ACTOR_LABEL);
  });

  it('keeps "Another member" for an owner MindsHub doesn\'t know', async () => {
    people.byIds.mockImplementation(async () => ({ reachable: true, people: [] }));
    const { result } = renderHook(() => useArtifactAuthorship(ANA_CAPS));
    await waitFor(() => expect(people.byIds).toHaveBeenCalled());
    await Promise.resolve();
    expect(result.current.label).toBe(OTHER_ACTOR_LABEL);
  });

  it.each([
    ['the viewer\'s own artifact', { role: 'owner', ownerUserId: 'u-me' }],
    ['an older server', { role: 'reviewer' }],
    ['an unknown owner', { role: 'reviewer', ownerUnknown: true }],
  ])('asks nothing for %s', async (_label, caps) => {
    renderHook(() => useArtifactAuthorship(caps));
    await Promise.resolve();
    expect(people.byIds).not.toHaveBeenCalled();
  });
});

function Marker({ caps }) {
  const authorship = useArtifactAuthorship(caps);
  return <span data-testid="marker">{authorship?.label ?? 'none'}</span>;
}

describe('ArtifactOwnerNamesProvider', () => {
  it('names every card\'s owner in one lookup', async () => {
    const list = [ANA_CAPS, ANA_CAPS, { role: 'reviewer', ownerUserId: 'u-bo' }, { role: 'owner' }];
    render(
      <ArtifactOwnerNamesProvider capabilitiesList={list}>
        {list.map((caps, i) => <Marker key={i} caps={caps} />)}
      </ArtifactOwnerNamesProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId('marker').map((m) => m.textContent))
      .toEqual(['Ana Ruiz', 'Ana Ruiz', 'bo@acme.com', 'none']));
    expect(people.byIds).toHaveBeenCalledTimes(1);
    expect(people.byIds).toHaveBeenCalledWith(['u-ana', 'u-bo']);
  });

  it('lets a marker the list never asked about ask for itself', async () => {
    render(
      <ArtifactOwnerNamesProvider capabilitiesList={[]}>
        <Marker caps={ANA_CAPS} />
      </ArtifactOwnerNamesProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('marker').textContent).toBe('Ana Ruiz'));
  });
});

describe('useArtifactAuthorships', () => {
  it('names the owners of many rows in one lookup', async () => {
    const list = [ANA_CAPS, { role: 'reviewer', ownerUserId: 'u-bo' }];
    const { result } = renderHook(() => useArtifactAuthorships(list));
    await waitFor(() => expect(result.current(ANA_CAPS).label).toBe('Ana Ruiz'));
    expect(result.current(list[1]).label).toBe('bo@acme.com');
    expect(people.byIds).toHaveBeenCalledTimes(1);
  });
});

describe('artifactOwnerIds', () => {
  it('lists each owner once and skips the rest', () => {
    expect(artifactOwnerIds([ANA_CAPS, ANA_CAPS, { role: 'owner', ownerUserId: 'u-me' }, null, undefined])).toEqual(['u-ana']);
  });
});
