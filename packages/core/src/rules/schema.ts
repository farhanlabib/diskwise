import { z } from 'zod';
import type { ActionId, Category, DepId, ProbeId, Rule } from '../types';

// Runtime enums mirroring the unions in types.ts. The `satisfies` clauses plus
// the Exclude<> checks below make a missing or misspelled member a compile error.
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

const DEP_IDS = [
  'xcode',
  'docker',
  'homebrew',
  'node',
  'pnpm',
  'yarn',
  'uv',
  'go',
  'python',
  'rust',
  'cocoapods',
] as const satisfies readonly DepId[];

const PROBE_IDS = [
  'simctl-runtimes',
  'simctl-devices',
  'docker-df',
  'macos-installers',
] as const satisfies readonly ProbeId[];

type Missing<T, U extends T> = Exclude<T, U> extends never ? true : never;
const _actionIdsCovered: Missing<ActionId, (typeof ACTION_IDS)[number]> = true;
const _categoriesCovered: Missing<Category, (typeof CATEGORIES)[number]> = true;
const _depIdsCovered: Missing<DepId, (typeof DEP_IDS)[number]> = true;
const _probeIdsCovered: Missing<ProbeId, (typeof PROBE_IDS)[number]> = true;

const idPattern = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const absoluteOrHome = (value: string) =>
  value === '~' || value.startsWith('/') || value.startsWith('~/');

const PathMatcher = z
  .object({
    kind: z.literal('path'),
    path: z.string(),
  })
  .strict();

const GlobChildrenMatcher = z
  .object({
    kind: z.literal('glob-children'),
    root: z.string(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    olderThanDays: z.number().int().min(1).optional(),
  })
  .strict();

const ProjectDirsMatcher = z
  .object({
    kind: z.literal('project-dirs'),
    searchRoots: z.array(z.string()).min(1),
    name: z.string(),
    marker: z.string(),
    maxAgeDays: z.number(),
    excludePrefixes: z.array(z.string()),
    maxDepth: z.number().optional(),
  })
  .strict();

const ProbeMatcher = z
  .object({
    kind: z.literal('probe'),
    probe: z.enum(PROBE_IDS),
  })
  .strict();

const VersionedChildrenMatcher = z
  .object({
    kind: z.literal('versioned-children'),
    root: z.string(),
    include: z.array(z.string()).optional(),
    keepNewest: z.number().int().min(1),
  })
  .strict();

const MatcherSchema = z.discriminatedUnion('kind', [
  PathMatcher,
  GlobChildrenMatcher,
  ProjectDirsMatcher,
  ProbeMatcher,
  VersionedChildrenMatcher,
]);

const PreflightSchema = z
  .object({
    processes: z.array(z.string()).optional(),
    daemons: z.array(z.enum(['docker'])).optional(),
    bootedSimulators: z.boolean().optional(),
  })
  .strict();

export const RuleSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(idPattern),
    title: z.string().min(1),
    category: z.enum(CATEGORIES),
    tier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    macos: z.string().optional(),
    requires: z.array(z.enum(DEP_IDS)).optional(),
    roots: z.array(z.string().refine(absoluteOrHome, 'root must start with "/" or "~/"')).min(1),
    matcher: MatcherSchema,
    action: z.enum(ACTION_IDS).nullable(),
    rationale: z.string().min(20),
    regeneration: z.string().min(10),
    preflight: PreflightSchema.optional(),
    minBytes: z.number().optional(),
    needsRoot: z.boolean().optional(),
    manualCommand: z.string().optional(),
    permanentOnly: z.boolean().optional(),
    docs: z.string().optional(),
  })
  .strict();

export type ParsedRule = z.infer<typeof RuleSchema>;

// Compile-time guarantee that the schema mirrors the Rule interface. If they
// drift, this assignment stops type-checking.
const _check: z.infer<typeof RuleSchema> extends Rule ? true : never = true;

export function parseRule(input: unknown): Rule {
  return RuleSchema.parse(input);
}
