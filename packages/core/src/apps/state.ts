import type { AppLocationKind, AppLocationState, Tier } from '../types';

// Single source of truth for location actionability. Producers stamp this onto
// every AppLocation and every consumer (totals, plans, UI, CLI) derives from
// the stamped state instead of re-deriving it from kind and tier.
export function appLocationState(
  kind: AppLocationKind,
  tier: Tier,
  orphaned: boolean,
): AppLocationState {
  if (tier <= 1) return 'cleanable';
  // Application Support / Containers left behind by an uninstalled app: user
  // data, so it is only ever trashed after an explicit opt-in.
  if (orphaned && kind === 'app-data') return 'deletableWithConfirmation';
  return 'reportOnly';
}
