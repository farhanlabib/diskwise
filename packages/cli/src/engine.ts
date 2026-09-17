import os from 'node:os';
import {
  allRules,
  audit,
  buildPlan as coreBuildPlan,
  executePlan as coreExecutePlan,
  lastAppliedRunId as coreLastAppliedRunId,
  listRuns as coreListRuns,
  undoRun as coreUndoRun,
  defaultJournalDir,
  defaultLockPath,
  openJournal,
  redactAudit,
  type AuditResult,
  type Category,
  type CleanupPlan,
  type ExecuteResult,
  type ItemResult,
  type JournalWriter,
  type PlanItem,
  type PlanSelection,
  type RunSummary,
  type Tier,
  type UndoItemResult,
} from '@macsweep/core';
import { sampleAudit } from '@macsweep/report';

export interface Engine {
  audit(opts: {
    category?: string;
    explain?: boolean;
    signal?: AbortSignal;
    onProgress?: (p: { entries: number; path: string }) => void;
  }): Promise<AuditResult>;
  listRules(): {
    id: string;
    title: string;
    tier: number;
    category: string;
    rationale: string;
    regeneration: string;
  }[];
  buildPlan(audit: AuditResult, selection: PlanSelection): CleanupPlan;
  executePlan(
    plan: CleanupPlan,
    opts: {
      apply: boolean;
      confirmedRuleIds: string[];
      permanentRuleIds?: string[];
      signal?: AbortSignal;
      onItem?: (r: ItemResult) => void;
    },
  ): Promise<ExecuteResult>;
  listRuns(): Promise<RunSummary[]>;
  lastAppliedRunId(): Promise<string | undefined>;
  undo(runId: string): Promise<UndoItemResult[]>;
  redact(audit: AuditResult, opts: { hashPaths: boolean }): AuditResult;
}

// The sample engine has no rule catalog, so it fakes a plan from the audit:
// one item per finding match that the selection keeps.
function samplePlan(auditResult: AuditResult, selection: PlanSelection): CleanupPlan {
  const tiers = new Set<Tier>((selection.tiers ?? [0, 1]).filter((tier) => tier !== 3));
  const categories = selection.categories === undefined ? undefined : new Set(selection.categories);
  const ruleIds = selection.ruleIds === undefined ? undefined : new Set(selection.ruleIds);

  const items: PlanItem[] = [];
  for (const finding of auditResult.findings) {
    if (finding.action === null) continue;
    if (!tiers.has(finding.tier)) continue;
    if (categories !== undefined && !categories.has(finding.category)) continue;
    if (ruleIds !== undefined && !ruleIds.has(finding.ruleId)) continue;
    const action = finding.action;

    finding.matches.forEach((match, index) => {
      items.push({
        id: `${finding.ruleId}#${index}`,
        ruleId: finding.ruleId,
        title: `${finding.title} - ${match.detail}`,
        category: finding.category,
        tier: finding.tier,
        action,
        permanentOnly: finding.permanentOnly,
        needsConfirmation: false,
        roots: ['/'],
        match,
      });
    });
  }

  const byTier: Record<Tier, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  let total = 0;
  for (const item of items) {
    byTier[item.tier] += item.match.bytesAllocated;
    total += item.match.bytesAllocated;
  }

  return {
    schemaVersion: 1,
    id: `sample-${Date.now()}`,
    createdAt: new Date().toISOString(),
    auditGeneratedAt: auditResult.generatedAt,
    items,
    manual: [],
    totals: { byTier, total },
  };
}

// Tests run the CLI on the sample audit; the binary installs the real core engine.
const defaultEngine: Engine = {
  async audit() {
    return sampleAudit;
  },
  listRules() {
    return [
      {
        id: 'xcode.derived-data',
        title: 'Xcode DerivedData',
        tier: 0,
        category: 'dev',
        rationale: 'Xcode rebuilds these from your source on the next build; nothing here is unique.',
        regeneration: 'Rebuilt locally on the next Xcode build (a few minutes)',
      },
      {
        id: 'dev.node-modules',
        title: 'node_modules in old projects',
        tier: 1,
        category: 'dev',
        rationale: 'Installed dependencies are reproducible from each project lockfile.',
        regeneration: 'pnpm install (or npm install) in each project',
      },
    ];
  },
  buildPlan: (auditResult, selection) => samplePlan(auditResult, selection),
  async executePlan(plan, opts) {
    const results: ItemResult[] = plan.items.map((item) => {
      const applied = opts.apply && !opts.signal?.aborted;
      const skipped = opts.signal?.aborted === true;
      return {
        itemId: item.id,
        ruleId: item.ruleId,
        action: item.action,
        status: skipped ? 'skipped' : applied ? 'done' : 'dry-run',
        ...(skipped ? { reason: 'cancelled' } : {}),
        path: item.match.path,
        bytesBefore: item.match.bytesAllocated,
        bytesAfter: applied ? 0 : item.match.bytesAllocated,
        freed: applied ? item.match.bytesAllocated : 0,
        restorable: false,
      };
    });
    for (const result of results) opts.onItem?.(result);
    return {
      planId: plan.id,
      apply: opts.apply,
      results,
      freed: results.reduce((sum, r) => sum + r.freed, 0),
    };
  },
  async listRuns() {
    return [];
  },
  async lastAppliedRunId() {
    return undefined;
  },
  async undo() {
    return [];
  },
  redact: (auditResult) => auditResult,
};

export const sampleEngine: Engine = defaultEngine;

export function createCoreEngine(): Engine {
  return {
    audit: (opts) =>
      audit({
        ...(opts.category ? { category: opts.category as Category } : {}),
        ...(opts.explain ? { includeSystemData: true } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
      }),
    listRules: () =>
      allRules.map(({ id, title, tier, category, rationale, regeneration }) => ({
        id,
        title,
        tier,
        category,
        rationale,
        regeneration,
      })),
    buildPlan: (auditResult, selection) => coreBuildPlan(auditResult, allRules, selection),
    async executePlan(plan, opts) {
      let journal: JournalWriter | undefined;
      try {
        if (opts.apply) {
          journal = await openJournal({ dir: defaultJournalDir(), lockPath: defaultLockPath() });
        }
        return await coreExecutePlan(plan, {
          apply: opts.apply,
          confirmedRuleIds: opts.confirmedRuleIds,
          ...(opts.permanentRuleIds ? { permanentRuleIds: opts.permanentRuleIds } : {}),
          ...(opts.signal ? { signal: opts.signal } : {}),
          ...(opts.onItem ? { onItem: opts.onItem } : {}),
          ...(journal ? { journal } : {}),
        });
      } finally {
        if (journal) await journal.close();
      }
    },
    listRuns: () => coreListRuns(defaultJournalDir()),
    lastAppliedRunId: () => coreLastAppliedRunId(defaultJournalDir()),
    undo: (runId) => coreUndoRun({ dir: defaultJournalDir(), lockPath: defaultLockPath(), runId }),
    redact: (auditResult, opts) =>
      redactAudit(auditResult, {
        home: os.homedir(),
        username: os.userInfo().username,
        hostname: os.hostname().replace(/\.local$/, ''),
        hashSegments: opts.hashPaths,
      }),
  };
}

let engine: Engine = defaultEngine;

export function setEngine(e: Engine): void {
  engine = e;
}

export function getEngine(): Engine {
  return engine;
}
