import type { AppProfile } from '../../types';

export const chromeProfile: AppProfile = {
  schemaVersion: 1,
  id: 'chrome',
  name: 'Google Chrome',
  bundleIds: ['com.google.Chrome'],
  caches: [
    {
      path: '~/Library/Caches/Google/Chrome',
      tier: 0,
      note: 'HTTP cache for the default profile',
    },
    {
      path: '~/Library/Application Support/Google/Chrome/Default/Service Worker/CacheStorage',
      tier: 0,
      note: 'Service worker files that offline-capable sites rebuild',
    },
    {
      path: '~/Library/Application Support/Google/Chrome/Default/Code Cache',
      tier: 0,
      note: 'Compiled JavaScript; rebuilt on the next visit',
    },
    {
      path: '~/Library/Application Support/Google/Chrome/GrShaderCache',
      tier: 0,
      note: 'GPU shader cache; rebuilt on launch',
    },
    {
      path: '~/Library/Application Support/Google/Chrome/ShaderCache',
      tier: 0,
      note: 'GPU shader cache; rebuilt on launch',
    },
  ],
  protect: ['~/Library/Application Support/Google/Chrome/Default'],
  rationale:
    'These Chrome folders hold only the HTTP cache, code cache and shader caches. Your profiles, cookies, history and bookmarks live under Default, which is protected; the listed cache subfolders are explicit profile caches and stay cleanable.',
  regeneration:
    'Pages, service worker files and shaders are cached again on the next visit (needs network).',
};
