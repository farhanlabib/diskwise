import type { AppProfile } from '../../types';

export const teamsProfile: AppProfile = {
  schemaVersion: 1,
  id: 'teams',
  name: 'Microsoft Teams',
  bundleIds: ['com.microsoft.teams2'],
  caches: [
    {
      path: '~/Library/Containers/com.microsoft.teams2/Data/Library/Caches',
      tier: 0,
      note: 'Downloaded web assets and images',
    },
    {
      path: '~/Library/Group Containers/UBF8T346G9.com.microsoft.teams/Library/Caches',
      tier: 0,
      note: 'Shared cache used by the Microsoft Office group container',
    },
  ],
  rationale:
    'Microsoft Teams stores only downloaded web assets in its container and group-container cache folders. Chats and shared files are kept on Microsoft servers and in other folders.',
  regeneration: 'Re-downloaded from Microsoft on the next launch.',
};
