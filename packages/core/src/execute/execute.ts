import os from 'node:os';

import { measure } from '../fs/walker';
import { trashItem } from '../native/helper';
import { runProbe } from '../probes/run';
import { assertPlanItemInCatalog, ruleById, type PlanRuleAuthority } from '../rules/catalog';
import { SafetyError } from '../safety/errors';
import { assertIdentity } from '../safety/identity';
import { assertSafeTarget } from '../safety/paths';
import type {
  ActionId,
  CleanupPlan,
  ExecuteOptions,
  ExecuteResult,
  ItemResult,
  JournalRecord,
  PlanItem,
} from '../types';
import { runAction, type ActionContext } from './actions';
import { checkPreflight } from './preflight';

const PATH_ACTIONS: ActionId[] = ['remove-path', 'remove-dir-contents', 'trash-path', 'empty-trash'];

// App plans (buildAppPlan) use generated pseudo-rule ids instead of catalog
// rules. They are built in-process and never loaded from a plan file, but
// executePlan is their shared entry point, so their recorded shape is enforced
// here too.
const APP_RULES: Readonly<Record<string, { action: ActionId; orphaned: boolean }>> = {
  'app.caches': { action: 'remove-dir-contents', orphaned: false },
  'app.logs': { action: 'remove-dir-contents', orphaned: false },
  'app.saved-state': { action: 'remove-path', orphaned: false },
  'app.orphaned-data': { action: 'trash-path', orphaned: true },
};

function appAuthority(item: PlanItem): PlanRuleAuthority {
  const spec = APP_RULES[item.ruleId];
  if (spec === undefined) {
    throw new Error(
      `unknown rule id "${item.ruleId}" in plan item "${item.id}" — regenerate the plan with 'diskwise plan'`,
    );
  }
  const tierOk = spec.orphaned ? item.tier === 2 : item.tier === 0 || item.tier === 1;
  const needsConfirmation = spec.orphaned;
  if (item.action !== spec.action) {
    throw new Error(
      `plan item "${item.id}" records action ${JSON.stringify(item.action)} but app rule "${item.ruleId}" only allows ${JSON.stringify(spec.action)}`,
    );
  }
  if (!tierOk) {
    throw new Error(
      `plan item "${item.id}" records tier ${item.tier} but app rule "${item.ruleId}" only allows ${spec.orphaned ? 2 : '0 or 1'}`,
    );
  }
  if (item.needsConfirmation !== needsConfirmation) {
    throw new Error(
      `plan item "${item.id}" records needsConfirmation ${item.needsConfirmation} but app rule "${item.ruleId}" requires ${needsConfirmation}`,
    );
  }
  if (item.match.path === undefined || JSON.stringify(item.roots) !== JSON.stringify([item.match.path])) {
    throw new Error(
      `plan item "${item.id}" must be rooted at its own match path (${JSON.stringify(item.match.path)})`,
    );
  }
  return {
    action: spec.action,
    tier: item.tier,
    roots: [item.match.path],
    permanentOnly: false,
    needsConfirmation,
    ...(item.preflight !== undefined ? { preflight: item.preflight } : {}),
  };
}

interface ResolvedItem {
  item: PlanItem;
  auth: PlanRuleAuthority;
}

function resolvePlanItems(plan: CleanupPlan): ResolvedItem[] {
  const seen = new Set<string>();
  return plan.items.map((item) => {
    if (seen.has(item.id)) {
      throw new Error(`duplicate item id "${item.id}" in plan`);
    }
    seen.add(item.id);
    const rule = ruleById.get(item.ruleId);
    const auth = rule !== undefined ? assertPlanItemInCatalog(item) : appAuthority(item);
    if (
      PATH_ACTIONS.includes(auth.action) &&
      (item.match.kind === 'virtual' || item.match.dev === undefined || item.match.ino === undefined)
    ) {
      throw new Error(
        `plan item "${item.id}" names the path action "${auth.action}" but records no target identity (dev, ino, kind) — regenerate the plan with 'diskwise plan'`,
      );
    }
    return { item, auth };
  });
}

function now(): string {
  return new Date().toISOString();
}

export async function executePlan(plan: CleanupPlan, opts: ExecuteOptions): Promise<ExecuteResult> {
  const resolved = resolvePlanItems(plan);
  const home = opts.home ?? os.homedir();
  const run = opts.run ?? runProbe;
  const trash =
    opts.trash ??
    (async (p: string): Promise<{ trashedPath: string }> => {
      const result = await trashItem(p);
      return { trashedPath: result.trashedPath };
    });
  const ctx: ActionContext = { home, run, trash, ...(opts.signal ? { signal: opts.signal } : {}) };
  const confirmed = new Set(opts.confirmedRuleIds ?? []);
  const permanentRules = new Set(opts.permanentRuleIds ?? []);
  // A dry run never touches the journal, even when a writer was supplied.
  const journal = opts.apply ? opts.journal : undefined;
  const results: ItemResult[] = [];

  if (journal) {
    await journal.append({
      type: 'run-start',
      runId: journal.runId,
      planId: plan.id,
      at: now(),
      apply: opts.apply,
      itemCount: plan.items.length,
    });
  }

  const processItem = async (item: PlanItem, auth: PlanRuleAuthority): Promise<ItemResult> => {
    const result: ItemResult = {
      itemId: item.id,
      ruleId: item.ruleId,
      action: auth.action,
      status: 'dry-run',
      path: item.match.path,
      bytesBefore: item.match.bytesAllocated,
      bytesAfter: item.match.bytesAllocated,
      freed: 0,
      restorable: false,
    };

    if (opts.signal?.aborted) {
      result.status = 'skipped';
      result.reason = 'cancelled';
      return result;
    }

    const permanent = auth.action === 'trash-path' && auth.tier === 2 && permanentRules.has(item.ruleId);

    if (permanentRules.has(item.ruleId) && !confirmed.has(item.ruleId)) {
      result.status = 'skipped';
      result.reason = 'permanent delete needs typed confirmation';
      return result;
    }

    if (auth.needsConfirmation && !confirmed.has(item.ruleId)) {
      result.status = 'skipped';
      result.reason = 'needs typed confirmation of the rule id';
      return result;
    }

    const blockers = await checkPreflight(auth.preflight, run, {
      ...(opts.runningBundleIds ? { runningBundleIds: opts.runningBundleIds } : {}),
    });
    if (blockers.length > 0) {
      result.status = 'skipped';
      result.reason = `blocked: ${blockers.join('; ')}`;
      return result;
    }

    const isPath = PATH_ACTIONS.includes(auth.action);
    if (isPath) {
      const target = item.match.path;
      if (!target) {
        result.status = 'failed';
        result.reason = 'match has no path';
        return result;
      }

      try {
        await assertSafeTarget(target, { id: item.ruleId, roots: auth.roots }, { home });
        await assertIdentity(target, {
          dev: item.match.dev,
          ino: item.match.ino,
          kind: item.match.kind,
        });
      } catch (err) {
        if (err instanceof SafetyError) {
          result.status = 'skipped';
          result.reason = `refused: ${err.code}`;
          return result;
        }
        throw err;
      }

      const before = await measure(target);
      result.bytesBefore = before.allocated;
      result.bytesAfter = before.allocated;
    }

    if (!opts.apply) {
      result.status = 'dry-run';
      return result;
    }

    if (journal) {
      await journal.append({
        type: 'intent',
        runId: journal.runId,
        at: now(),
        itemId: item.id,
        ruleId: item.ruleId,
        action: auth.action,
        path: item.match.path,
        ...(permanent ? { permanent: true } : {}),
      } as JournalRecord);
    }

    try {
      // runAction still expects a PlanItem; the authoritative fields are written
      // back so the plan's copies cannot leak through.
      const actionItem: PlanItem = {
        ...item,
        action: auth.action,
        tier: auth.tier,
        roots: auth.roots,
        permanentOnly: auth.permanentOnly,
        needsConfirmation: auth.needsConfirmation,
      };
      const actionResult = await runAction(actionItem, ctx, { permanent });
      // Record the Trash destination before the result so a crash in between
      // still leaves enough information to undo the move.
      if (journal && actionResult.trashedPath !== undefined) {
        await journal.append({
          type: 'trash-destination',
          runId: journal.runId,
          at: now(),
          itemId: item.id,
          trashedPath: actionResult.trashedPath,
        });
      }
      if (isPath && item.match.path) {
        result.bytesAfter = (await measure(item.match.path)).allocated;
      } else {
        result.bytesAfter = 0;
      }
      result.freed = Math.max(0, result.bytesBefore - result.bytesAfter);
      result.status = 'done';
      result.restorable = actionResult.restorable;
      if (actionResult.trashedPath !== undefined) result.trashedPath = actionResult.trashedPath;
    } catch (err) {
      result.status = 'failed';
      result.reason = err instanceof Error ? err.message : String(err);
      result.bytesAfter = result.bytesBefore;
      result.freed = 0;
    }

    return result;
  };

  for (const { item, auth } of resolved) {
    const result = await processItem(item, auth);
    if (journal) {
      await journal.append({ type: 'result', runId: journal.runId, at: now(), result });
    }
    opts.onItem?.(result);
    results.push(result);
  }

  const freed = results.reduce((sum, r) => sum + r.freed, 0);

  if (journal) {
    await journal.append({ type: 'run-end', runId: journal.runId, at: now(), freed });
  }

  return { planId: plan.id, runId: journal?.runId, apply: opts.apply, results, freed };
}
