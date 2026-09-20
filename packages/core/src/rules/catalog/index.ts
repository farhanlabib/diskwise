import type { ActionId, PlanItem, Preflight, Rule, Tier } from '../../types';
import { browserRules } from './browser';
import { cacheRules } from './caches';
import { devRules } from './dev';
import { dockerRules } from './docker';
import { osLeftoverRules } from './os-leftovers';
import { simulatorRules } from './simulator';
import { systemRules } from './system';
import { userDataRules } from './user-data';

export const allRules: Rule[] = [
  ...devRules,
  ...cacheRules,
  ...dockerRules,
  ...simulatorRules,
  ...osLeftoverRules,
  ...userDataRules,
  ...browserRules,
  ...systemRules,
];

export const ruleById: ReadonlyMap<string, Rule> = new Map(allRules.map((rule) => [rule.id, rule]));

// The safety-relevant values execution must take from the resolved rule, never
// from the plan JSON.
export interface PlanRuleAuthority {
  action: ActionId;
  tier: Tier;
  roots: string[];
  permanentOnly: boolean;
  needsConfirmation: boolean;
  preflight?: Preflight;
}

// The catalog, not the plan file, is the execution authority: a saved plan item
// may only repeat what the rule it names currently says. Anything else — a
// renamed action, a widened root, a removed confirmation — is a tampered or
// stale plan and is rejected.
export function assertPlanItemInCatalog(item: PlanItem): PlanRuleAuthority {
  const rule = ruleById.get(item.ruleId);
  if (rule === undefined) {
    throw new Error(
      `unknown rule id "${item.ruleId}" in plan item "${item.id}" — regenerate the plan with 'diskwise plan'`,
    );
  }

  const conflict = (field: string, recorded: unknown, current: unknown): Error =>
    new Error(
      `plan item "${item.id}" records ${field} ${JSON.stringify(recorded)} but rule "${rule.id}" now uses ${JSON.stringify(current)} — regenerate the plan with 'diskwise plan'`,
    );

  const { action } = rule;
  if (action === null) throw conflict('action', item.action, null);
  const needsConfirmation = rule.tier === 2 || rule.permanentOnly === true;
  const permanentOnly = rule.permanentOnly ?? false;

  if (item.action !== action) throw conflict('action', item.action, action);
  if (item.tier !== rule.tier) throw conflict('tier', item.tier, rule.tier);
  if (item.permanentOnly !== permanentOnly) {
    throw conflict('permanentOnly', item.permanentOnly, permanentOnly);
  }
  if (item.needsConfirmation !== needsConfirmation) {
    throw conflict('needsConfirmation', item.needsConfirmation, needsConfirmation);
  }
  if (JSON.stringify(item.roots) !== JSON.stringify(rule.roots)) {
    throw conflict('roots', item.roots, rule.roots);
  }
  if (JSON.stringify(item.preflight ?? null) !== JSON.stringify(rule.preflight ?? null)) {
    throw conflict('preflight', item.preflight ?? null, rule.preflight ?? null);
  }

  return {
    action,
    tier: rule.tier,
    roots: rule.roots,
    permanentOnly,
    needsConfirmation,
    ...(rule.preflight !== undefined ? { preflight: rule.preflight } : {}),
  };
}
