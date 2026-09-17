import type { AppProfile } from '../../types';
import { adobeProfile } from './adobe';
import { arcProfile } from './arc';
import { braveProfile } from './brave';
import { chromeProfile } from './chrome';
import { cursorProfile } from './cursor';
import { discordProfile } from './discord';
import { figmaProfile } from './figma';
import { firefoxProfile } from './firefox';
import { jetbrainsProfile } from './jetbrains';
import { notionProfile } from './notion';
import { postmanProfile } from './postman';
import { safariProfile } from './safari';
import { slackProfile } from './slack';
import { spotifyProfile } from './spotify';
import { telegramProfile } from './telegram';
import { teamsProfile } from './teams';
import { vscodeProfile } from './vscode';
import { whatsappProfile } from './whatsapp';
import { zoomProfile } from './zoom';

// Reviewed, declarative knowledge about popular apps. Profiles take precedence
// over the generic heuristics in locations.ts.
export const appProfiles: AppProfile[] = [
  slackProfile,
  discordProfile,
  vscodeProfile,
  cursorProfile,
  teamsProfile,
  zoomProfile,
  spotifyProfile,
  notionProfile,
  figmaProfile,
  chromeProfile,
  postmanProfile,
  telegramProfile,
  whatsappProfile,
  jetbrainsProfile,
  adobeProfile,
  arcProfile,
  braveProfile,
  firefoxProfile,
  safariProfile,
];

export function profileForBundleId(bundleId: string): AppProfile | undefined {
  return appProfiles.find((profile) => profile.bundleIds.includes(bundleId));
}
