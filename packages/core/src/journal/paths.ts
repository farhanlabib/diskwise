import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultJournalDir(home: string = homedir()): string {
  return join(home, '.macsweep', 'journal');
}

export function defaultLockPath(home: string = homedir()): string {
  return join(home, '.macsweep', 'lock');
}
