import type { AppProfile } from '../../types';

export const braveProfile: AppProfile = {
  schemaVersion: 1,
  id: 'brave',
  name: 'Brave',
  bundleIds: ['com.brave.Browser'],
  caches: [
    {
      path: '~/Library/Caches/BraveSoftware/Brave-Browser',
      tier: 0,
      note: 'HTTP cache for the default profile',
    },
    {
      path: '~/Library/Application Support/BraveSoftware/Brave-Browser/Default/Code Cache',
      tier: 0,
      note: 'Compiled JavaScript; rebuilt on the next visit',
    },
    {
      path: '~/Library/Application Support/BraveSoftware/Brave-Browser/Default/Service Worker/CacheStorage',
      tier: 0,
      note: 'Service worker files that offline-capable sites rebuild',
    },
  ],
  protect: ['~/Library/Application Support/BraveSoftware/Brave-Browser/Default'],
  rationale:
    'Brave is Chromium-based. These folders hold only the HTTP cache, code cache and service worker storage for the default profile, all of which Brave rebuilds. Your history, bookmarks, passwords, extensions and cookies live under Default, which is protected; the listed subfolders are explicit caches and stay cleanable.',
  regeneration:
    'Pages, service worker files and compiled scripts are cached again on the next visit (needs network).',
};
