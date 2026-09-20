import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_KEY, loadSettings, saveSettings } from './settings';

function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string): string | null => store.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        store.set(key, value);
      },
    },
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadSettings', () => {
  it('returns the defaults when nothing is stored', () => {
    stubStorage();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('reads stored values and falls back per field', () => {
    const store = stubStorage();
    store.set(SETTINGS_KEY, JSON.stringify({ theme: 'dark', redact: false }));
    expect(loadSettings()).toEqual({ theme: 'dark', nodeModulesAgeDays: 14, redact: false });

    store.set(
      SETTINGS_KEY,
      JSON.stringify({ theme: 'neon', nodeModulesAgeDays: 'soon', redact: 'yes' }),
    );
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects non-finite thresholds', () => {
    const store = stubStorage();
    store.set(SETTINGS_KEY, JSON.stringify({ nodeModulesAgeDays: Number.NaN }));
    expect(loadSettings().nodeModulesAgeDays).toBe(14);
  });

  it('returns the defaults when the stored JSON is malformed', () => {
    const store = stubStorage();
    store.set(SETTINGS_KEY, '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('returns the defaults when storage itself throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (): string => {
          throw new Error('blocked');
        },
      },
    });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe('saveSettings', () => {
  it('merges a patch onto the stored settings and persists it', () => {
    const store = stubStorage();

    expect(saveSettings({ theme: 'light' })).toEqual({ ...DEFAULT_SETTINGS, theme: 'light' });
    expect(JSON.parse(store.get(SETTINGS_KEY) ?? '{}')).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'light',
    });

    expect(saveSettings({ redact: false })).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'light',
      redact: false,
    });
  });
});
