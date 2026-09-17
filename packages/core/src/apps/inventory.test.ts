import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runProbe } from '../probes/run';
import { listInstalledApps } from './inventory';

const CHAT_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.test.chat</string>
  <key>CFBundleName</key>
  <string>Chat</string>
  <key>CFBundleShortVersionString</key>
  <string>1.2.3</string>
</dict>
</plist>
`;

const OTHER_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>Other</string>
</dict>
</plist>
`;

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'macsweep-apps-inventory-'));
  roots.push(dir);
  return dir;
}

async function writePlist(appPath: string, xml: string): Promise<void> {
  const plistPath = join(appPath, 'Contents', 'Info.plist');
  await mkdir(dirname(plistPath), { recursive: true });
  await writeFile(plistPath, xml);
}

afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('listInstalledApps', () => {
  it('finds apps, reads the plist and mdls, and measures the bundle', async () => {
    const root = await makeRoot();
    const appsRoot = join(root, 'Applications');
    const chatPath = join(appsRoot, 'Chat.app');
    await writePlist(chatPath, CHAT_PLIST);
    await writePlist(join(appsRoot, 'Folder', 'Other.app'), OTHER_PLIST);

    const apps = await listInstalledApps({
      home: root,
      run: runProbe,
      roots: [appsRoot],
      runningBundleIds: async () => ['com.test.chat'],
      measureBundles: true,
    });

    expect(apps).toHaveLength(1);
    const [chat] = apps;
    expect(chat).toBeDefined();
    expect(chat!.bundleId).toBe('com.test.chat');
    expect(chat!.name).toBe('Chat');
    expect(chat!.version).toBe('1.2.3');
    expect(chat!.running).toBe(true);
    expect(chat!.system).toBe(false);
    expect(chat!.bundleBytes).toBeGreaterThan(0);
  });

  it('skips bundles without measureBundles but still lists them', async () => {
    const root = await makeRoot();
    const appsRoot = join(root, 'Applications');
    await writePlist(join(appsRoot, 'Chat.app'), CHAT_PLIST);

    const apps = await listInstalledApps({
      home: root,
      run: runProbe,
      roots: [appsRoot],
      runningBundleIds: async () => [],
      measureBundles: false,
    });

    expect(apps).toHaveLength(1);
    expect(apps[0]!.bundleBytes).toBe(0);
    expect(apps[0]!.running).toBe(false);
  });

  it('returns [] for a missing root', async () => {
    const root = await makeRoot();
    const apps = await listInstalledApps({
      home: root,
      run: runProbe,
      roots: [join(root, 'Applications')],
      runningBundleIds: async () => [],
      measureBundles: false,
    });
    expect(apps).toEqual([]);
  });
});
