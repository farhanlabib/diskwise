import type { AppProfile } from '../../types';

export const postmanProfile: AppProfile = {
  schemaVersion: 1,
  id: 'postman',
  name: 'Postman',
  bundleIds: ['com.postmanlabs.mac'],
  caches: [
    {
      path: '~/Library/Application Support/Postman/Cache',
      tier: 0,
      note: 'HTTP cache of API responses; rebuilt as you open requests',
    },
    {
      path: '~/Library/Application Support/Postman/Code Cache',
      tier: 0,
      note: 'Compiled JavaScript; rebuilt on the next launch',
    },
    {
      path: '~/Library/Application Support/Postman/GPUCache',
      tier: 0,
      note: 'GPU shader cache; rebuilt on launch',
    },
  ],
  protect: ['~/Library/Application Support/Postman/Partitions'],
  rationale:
    'Postman is an Electron app. These three folders are its Chromium HTTP, code and GPU caches, which it rebuilds on its own. Your collections, environments and history live under Partitions, which is protected and never offered.',
  regeneration:
    'Nothing to download. Postman rebuilds the caches on its next launch, which is slower until they fill again.',
};
