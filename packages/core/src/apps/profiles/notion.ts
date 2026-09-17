import type { AppProfile } from '../../types';

export const notionProfile: AppProfile = {
  schemaVersion: 1,
  id: 'notion',
  name: 'Notion',
  bundleIds: ['notion.id'],
  caches: [
    {
      path: '~/Library/Application Support/Notion/Partitions/notion/Cache',
      tier: 0,
      note: 'Downloaded pages and images',
    },
    {
      path: '~/Library/Application Support/Notion/Partitions/notion/Code Cache',
      tier: 0,
      note: 'Compiled JavaScript for the Electron client',
    },
  ],
  rationale:
    'Notion runs as an Electron app and caches downloaded pages and assets per partition. Your notes live on Notion servers and are not in these folders.',
  regeneration: 'Re-downloaded from Notion on the next launch.',
};
