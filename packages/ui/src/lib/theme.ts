import type { ThemePreference } from './settings';
import { loadSettings, saveSettings } from './settings';

export type Theme = 'light' | 'dark';

let preference: ThemePreference = 'system';
const listeners = new Set<(theme: Theme) => void>();

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function current(): Theme {
  return preference === 'system' ? systemTheme() : preference;
}

function apply(): void {
  const theme = current();
  document.documentElement.setAttribute('data-theme', theme);
  for (const listener of listeners) listener(theme);
}

export function initTheme(): void {
  preference = loadSettings().theme;
  apply();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (preference === 'system') apply();
  });
}

export function getTheme(): Theme {
  return current();
}

export function getThemePreference(): ThemePreference {
  return preference;
}

export function setThemePreference(value: ThemePreference): void {
  preference = value;
  saveSettings({ theme: value });
  apply();
}

export function setTheme(theme: Theme): void {
  setThemePreference(theme);
}

export function subscribeTheme(listener: (theme: Theme) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
