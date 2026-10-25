import { describe, expect, it, vi } from 'vitest';
vi.mock('../api', () => ({ revokeLiveAppPreviews: vi.fn() }));
import { liveAppPreviewOrigin } from './liveAppPreview';
const state = { state: 'running', slot: 1, launchId: '11111111-1111-4111-8111-111111111111', address: 'http://app1.view.localhost:8080/' };
describe('preview origin', () => {
  it('accepts the exact server-selected slot', () => expect(liveAppPreviewOrigin(state)).toBe('http://app1.view.localhost:8080'));
  it.each([
    { slot: 0 }, { slot: 17 }, { slot: 1.1 }, { launchId: '' }, { state: 'stopped' },
    { address: 'http://cowork.localhost:8080/' }, { address: 'http://localhost:8000/' },
    { address: 'http://app2.view.localhost:8080/' }, { address: 'http://app1.view.localhost:8080/?token=x' },
    { address: 'http://app1.view.localhost:8080/#x' }, { address: 'http://user@app1.view.localhost:8080/' },
    { address: 'http://app1.view.localhost:8080.evil.test/' },
  ])('refuses an invalid launch or address: %s', change => expect(liveAppPreviewOrigin({ ...state, ...change })).toBe(''));
});
