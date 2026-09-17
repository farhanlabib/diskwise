import fs from 'node:fs/promises';

import { SafetyError } from './errors';

export async function assertIdentity(
  path: string,
  expected: { dev?: number; ino?: number; kind: 'dir' | 'file' | 'virtual' },
): Promise<void> {
  if (expected.kind === 'virtual') return;

  let stat;
  try {
    stat = await fs.lstat(path);
  } catch {
    throw new SafetyError('MISSING', path);
  }

  if (stat.isSymbolicLink()) {
    throw new SafetyError('TYPE_MISMATCH', path);
  }
  if (expected.kind === 'dir' && !stat.isDirectory()) {
    throw new SafetyError('TYPE_MISMATCH', path);
  }
  if (expected.kind === 'file' && !stat.isFile()) {
    throw new SafetyError('TYPE_MISMATCH', path);
  }

  if (expected.dev !== undefined && expected.dev !== stat.dev) {
    throw new SafetyError('IDENTITY_MISMATCH', path);
  }
  if (expected.ino !== undefined && expected.ino !== stat.ino) {
    throw new SafetyError('IDENTITY_MISMATCH', path);
  }
}
