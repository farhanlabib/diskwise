import type { AppProfile } from '../../types';

export const zoomProfile: AppProfile = {
  schemaVersion: 1,
  id: 'zoom',
  name: 'Zoom',
  bundleIds: ['us.zoom.xos'],
  caches: [
    {
      path: '~/Library/Application Support/zoom.us/data/ZoomAutoUpdater',
      tier: 1,
      note: 'Downloaded updates',
    },
  ],
  rationale:
    'Zoom keeps downloaded installer and updater payloads here. They are only needed once, and Zoom fetches them again when the next update is available.',
  regeneration: 'Re-downloaded from Zoom when the next update runs.',
};
