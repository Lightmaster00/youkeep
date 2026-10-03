import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useLanding } from '../../app/composables/useLanding';
import { buildView } from '../../shared/displayPrefs';

const fetchMock = vi.fn();
vi.stubGlobal('$fetch', fetchMock);

const realSessionStorage = window.sessionStorage;

let modulesResponse = { video: true, music: true, podcasts: true };
let displayResponse = buildView({}, null);

function setUser(id: string | null) {
  useState<any>('auth_user').value = id ? { id, username: id, role: 'user' } : null;
}

beforeEach(() => {
  fetchMock.mockReset();
  modulesResponse = { video: true, music: true, podcasts: true };
  displayResponse = buildView({}, null);
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/settings/modules') return modulesResponse;
    if (url === '/api/settings/display') return displayResponse;
    throw new Error(`unexpected fetch ${url}`);
  });
  useState<any>('modules').value = { video: true, music: true, podcasts: true };
  useState<boolean>('modules_loaded').value = false;
  useState<any>('display_prefs').value = buildView({}, null);
  useState<any>('display_prefs_for').value = undefined;
  setUser(null);
  window.sessionStorage.clear();
});

afterEach(() => {
  Object.defineProperty(window, 'sessionStorage', { configurable: true, writable: true, value: realSessionStorage });
});

describe('useLanding.consumeLandingTarget', () => {
  it('returns null for the default (auto, Video enabled) and still consumes the once-per-session marker', async () => {
    const { consumeLandingTarget } = useLanding();
    expect(await consumeLandingTarget()).toBeNull();
    expect(window.sessionStorage.getItem('landing_applied')).toBe('guest');
  });

  it('returns the chosen space home the first time only', async () => {
    displayResponse = buildView({ landingSpace: 'music' }, null);
    const { consumeLandingTarget } = useLanding();
    expect(await consumeLandingTarget()).toBe('/music');
    expect(await consumeLandingTarget()).toBeNull();
  });

  it('applies again for a different user in the same tab', async () => {
    displayResponse = buildView({ landingSpace: 'podcasts' }, null);
    const { consumeLandingTarget } = useLanding();
    expect(await consumeLandingTarget()).toBe('/podcasts');
    setUser('u1');
    expect(await consumeLandingTarget()).toBe('/podcasts');
    expect(window.sessionStorage.getItem('landing_applied')).toBe('u1');
  });

  it('ignores an explicit choice that points to a disabled module', async () => {
    modulesResponse = { video: true, music: false, podcasts: true };
    displayResponse = buildView({ landingSpace: 'music' }, null);
    const { consumeLandingTarget } = useLanding();
    expect(await consumeLandingTarget()).toBeNull();
  });

  it('with auto and Video disabled goes to the first enabled module', async () => {
    modulesResponse = { video: false, music: false, podcasts: true };
    const { consumeLandingTarget } = useLanding();
    expect(await consumeLandingTarget()).toBe('/podcasts');
  });

  it('never redirects (and never throws) when sessionStorage is unavailable', async () => {
    displayResponse = buildView({ landingSpace: 'music' }, null);
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      writable: true,
      value: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, clear: () => {} },
    });
    const { consumeLandingTarget } = useLanding();
    expect(await consumeLandingTarget()).toBeNull();
  });
});
