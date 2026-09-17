export type ThemePreference = 'system' | 'light' | 'dark';

export interface Settings {
  theme: ThemePreference;
  nodeModulesAgeDays: number;
  redact: boolean;
}

export const SETTINGS_KEY = 'macsweep.settings';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  nodeModulesAgeDays: 14,
  redact: true,
};

export function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const theme =
      parsed.theme === 'system' || parsed.theme === 'light' || parsed.theme === 'dark'
        ? parsed.theme
        : DEFAULT_SETTINGS.theme;
    const nodeModulesAgeDays =
      typeof parsed.nodeModulesAgeDays === 'number' && Number.isFinite(parsed.nodeModulesAgeDays)
        ? parsed.nodeModulesAgeDays
        : DEFAULT_SETTINGS.nodeModulesAgeDays;
    const redact = typeof parsed.redact === 'boolean' ? parsed.redact : DEFAULT_SETTINGS.redact;
    return { theme, nodeModulesAgeDays, redact };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}
