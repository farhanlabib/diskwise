import type { AppProfile } from '../../types';

export const figmaProfile: AppProfile = {
  schemaVersion: 1,
  id: 'figma',
  name: 'Figma',
  bundleIds: ['com.figma.Desktop'],
  caches: [
    {
      path: '~/Library/Caches/com.figma.agent',
      tier: 0,
      note: 'Downloaded agent updates and web assets',
    },
  ],
  protect: ['~/Library/Application Support/Figma/DesktopProfile'],
  rationale:
    'Figma keeps downloaded agent builds and web assets in its cache. The DesktopProfile folder holds app data such as your local files list, so it is protected and never offered.',
  regeneration: 'Re-downloaded from Figma on the next launch.',
};
