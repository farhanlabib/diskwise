import { z } from 'zod';
import type { ActionId, Category, CleanupPlan } from '../types';

// Runtime enums mirroring the unions in types.ts. The `satisfies` clause plus the
// Exclude<> check below make a missing or misspelled action a compile error.
const ACTION_IDS = [
  'simctl-runtime-delete',
  'simctl-device-delete-unavailable',
  'simctl-device-delete',
  'brew-cleanup',
  'docker-builder-prune',
  'docker-image-prune',
  'docker-container-prune',
  'npm-cache-clean',
  'pnpm-store-prune',
  'yarn-cache-clean',
  'uv-cache-clean',
  'go-clean-build',
  'go-clean-mod',
  'trash-path',
  'remove-path',
  'remove-dir-contents',
  'empty-trash',
] as const satisfies readonly ActionId[];

const CATEGORIES = [
  'dev',
  'system',
  'browser',
  'app',
  'user-data',
  'os-leftovers',
] as const satisfies readonly Category[];

type Missing<T, U extends T> = Exclude<T, U> extends never ? true : never;
const _actionIdsCovered: Missing<ActionId, (typeof ACTION_IDS)[number]> = true;
const _categoriesCovered: Missing<Category, (typeof CATEGORIES)[number]> = true;

const TierSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

const ByTierSchema = z.object({
  0: z.number(),
  1: z.number(),
  2: z.number(),
  3: z.number(),
});

const PreflightSchema = z
  .object({
    processes: z.array(z.string()).optional(),
    daemons: z.array(z.enum(['docker'])).optional(),
    bootedSimulators: z.boolean().optional(),
    apps: z.array(z.object({ bundleId: z.string(), name: z.string() }).strict()).optional(),
  })
  .strict();

// Match mirrors types.ts Match. Extra keys (bytesReclaimable, unreadable, ...)
// are passed through so a plan round-trips without losing information.
const MatchSchema = z
  .object({
    kind: z.enum(['dir', 'file', 'virtual']),
    path: z.string().optional(),
    dev: z.number().optional(),
    ino: z.number().optional(),
    bytesAllocated: z.number().min(0),
    bytesApparent: z.number().min(0),
    detail: z.string(),
    actionArgs: z.record(z.string()).optional(),
  })
  .passthrough();

const PlanItemSchema = z
  .object({
    id: z.string().min(1),
    ruleId: z.string().min(1),
    title: z.string(),
    category: z.enum(CATEGORIES),
    tier: TierSchema,
    action: z.enum(ACTION_IDS),
    permanentOnly: z.boolean(),
    needsConfirmation: z.boolean(),
    preflight: PreflightSchema.optional(),
    roots: z.array(z.string()),
    match: MatchSchema,
  })
  .strict();

const ManualStepSchema = z
  .object({
    ruleId: z.string().min(1),
    title: z.string(),
    command: z.string(),
    bytes: z.number(),
  })
  .strict();

export const CleanupPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    createdAt: z.string(),
    auditGeneratedAt: z.string(),
    items: z.array(PlanItemSchema),
    manual: z.array(ManualStepSchema),
    totals: z
      .object({
        byTier: ByTierSchema,
        total: z.number(),
      })
      .strict(),
  })
  .strict()
  .superRefine((plan, ctx) => {
    plan.items.forEach((item, index) => {
      if (item.match.path !== undefined && !item.match.path.startsWith('/')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'match', 'path'],
          message: 'match.path must be absolute',
        });
      }
    });

    const seen = new Set<string>();
    plan.items.forEach((item, index) => {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'id'],
          message: `duplicate item id: ${item.id}`,
        });
      }
      seen.add(item.id);
    });
  });

export type ParsedCleanupPlan = z.infer<typeof CleanupPlanSchema>;

// Compile-time guarantee that the schema mirrors the CleanupPlan interface.
const _check: z.infer<typeof CleanupPlanSchema> extends CleanupPlan ? true : never = true;

export function parsePlan(json: string): CleanupPlan {
  try {
    return CleanupPlanSchema.parse(JSON.parse(json));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid plan: ${detail}`);
  }
}

export function serializePlan(plan: CleanupPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}
