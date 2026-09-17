import type { AppProfile } from '../../types';

export const spotifyProfile: AppProfile = {
  schemaVersion: 1,
  id: 'spotify',
  name: 'Spotify',
  bundleIds: ['com.spotify.client'],
  caches: [
    {
      path: '~/Library/Caches/com.spotify.client/Data',
      tier: 1,
      note: 'Offline songs and streamed audio; Spotify downloads them again',
    },
    {
      path: '~/Library/Application Support/Spotify/PersistentCache',
      tier: 1,
      note: 'Album art and track metadata',
    },
  ],
  rationale:
    'Spotify stores offline songs and streamed audio in its cache, and album art and metadata in PersistentCache. Nothing here is user-authored: playlists and saved music live on Spotify servers.',
  regeneration:
    'Songs re-download the next time you play them, and artwork returns with the next launch (needs network).',
};
