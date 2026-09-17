import type { AppProfile } from '../../types';

export const whatsappProfile: AppProfile = {
  schemaVersion: 1,
  id: 'whatsapp',
  name: 'WhatsApp',
  bundleIds: ['net.whatsapp.WhatsApp'],
  caches: [
    {
      path: '~/Library/Caches/net.whatsapp.WhatsApp',
      tier: 0,
      note: 'Rebuilt by WhatsApp on the next launch',
    },
  ],
  protect: ['~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared'],
  rationale:
    'WhatsApp stores your chats and the media in them in its shared group container, which is protected. That data is handled separately by macsweep’s Tier 2 WhatsApp media rule, which moves it to the Trash only on request; here only the app-level cache folder is offered.',
  regeneration:
    'Nothing to download. WhatsApp rebuilds its cache folder on the next launch; cleared media is re-fetched from the sender while the message is still in the chat.',
};
