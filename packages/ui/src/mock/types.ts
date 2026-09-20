import type { Tier } from '@diskwise/core/types';

export interface AppEntry {
  id: string;
  name: string;
  initial: string;
  bundleId: string;
  version: string;
  lastUsed: string;
  running: boolean;
  orphan: boolean;
  knownProfile: boolean;
  cachesBytes: number;
  appDataBytes: number;
  totalBytes: number;
  color: string;
}

export type AppLocationAction = 'clean' | 'trash' | 'report' | 'finder' | 'protected';

export interface AppLocationGroup {
  id: string;
  name: string;
  sizeBytes: number;
  tier: Tier;
  note: string;
  folders?: string[];
  noAction?: string;
  action: AppLocationAction;
}

export interface HistoryRun {
  id: string;
  date: string;
  items: number;
  freedBytes: number;
  undoable: boolean;
  reason?: string;
}

export interface DiskSegment {
  id: string;
  label: string;
  sizeGb: number;
  hatch?: boolean;
  color?: string;
}

export interface SystemBucket {
  id: string;
  name: string;
  note: string;
  tier: Tier;
  sizeBytes: number;
  sizeLabel: string;
  path: string;
  what: string;
  safe: string;
  command?: string;
  reviewable: boolean;
}

export interface LargestWin {
  ruleId: string;
  title: string;
  detail: string;
  sizeBytes: number;
  tier: Tier;
}

export interface ScanBucket {
  id: string;
  label: string;
  state: 'done' | 'scanning' | 'queued';
  sizeLabel: string;
}

export interface RunItem {
  id: string;
  title: string;
  sizeBytes: number;
  freedBytes: number;
}
