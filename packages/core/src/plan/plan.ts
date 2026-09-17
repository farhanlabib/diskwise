import { randomUUID } from 'node:crypto';
import type {
  AuditResult,
  Category,
  CleanupPlan,
  Finding,
  ManualStep,
  PlanItem,
  PlanSelection,
  Rule,
  Tier,
} from '../types';

// Tier 2 is never on by default: it holds user data and needs an explicit ask.
// Tier 3 is never available, even when asked for.
const DEFAULT_TIERS: Tier[] = [0, 1];

export interface BuildPlanOptions {
  id?: string;
  now?: Date;
}

export function buildPlan(
  audit: AuditResult,
  rules: Rule[],
  selection: PlanSelection = {},
  opts: BuildPlanOptions = {},
): CleanupPlan {
  const rulesById = new Map(rules.map((rule) => [rule.id, rule]));
  const tiers = new Set<Tier>((selection.tiers ?? DEFAULT_TIERS).filter((tier) => tier !== 3));
  const categories = selection.categories === undefined ? undefined : new Set<Category>(selection.categories);
  const ruleIds = selection.ruleIds === undefined ? undefined : new Set<string>(selection.ruleIds);
  const itemIds = selection.itemIds === undefined ? undefined : new Set<string>(selection.itemIds);

  const passes = (finding: Finding): boolean =>
    tiers.has(finding.tier) &&
    (categories === undefined || categories.has(finding.category)) &&
    (ruleIds === undefined || ruleIds.has(finding.ruleId));

  const items: PlanItem[] = [];
  const manual: ManualStep[] = [];
  const counters = new Map<string, number>();

  for (const finding of audit.findings) {
    const rule = rulesById.get(finding.ruleId);
    if (rule === undefined) continue;
    if (!passes(finding)) continue;

    if (finding.action === null) {
      if (finding.needsRoot && finding.manualCommand !== undefined) {
        manual.push({
          ruleId: finding.ruleId,
          title: finding.title,
          command: finding.manualCommand,
          bytes: finding.totals.allocated,
        });
      }
      continue;
    }

    for (const match of finding.matches) {
      const n = counters.get(finding.ruleId) ?? 0;
      counters.set(finding.ruleId, n + 1);
      items.push({
        id: `${finding.ruleId}#${n}`,
        ruleId: finding.ruleId,
        title: `${finding.title} - ${match.detail}`,
        category: finding.category,
        tier: finding.tier,
        action: finding.action,
        permanentOnly: finding.permanentOnly,
        needsConfirmation: finding.tier === 2 || finding.permanentOnly,
        preflight: rule.preflight,
        roots: rule.roots,
        match,
      });
    }
  }

  const selected = itemIds === undefined ? items : items.filter((item) => itemIds.has(item.id));

  const byTier: Record<Tier, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  let total = 0;
  for (const item of selected) {
    byTier[item.tier] += item.match.bytesAllocated;
    total += item.match.bytesAllocated;
  }

  return {
    schemaVersion: 1,
    id: opts.id ?? randomUUID(),
    createdAt: (opts.now ?? new Date()).toISOString(),
    auditGeneratedAt: audit.generatedAt,
    items: selected,
    manual,
    totals: { byTier, total },
  };
}
