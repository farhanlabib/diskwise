import type {
  AppReport,
  AuditResult,
  BuildAppPlanOptions,
  CleanupPlan,
  ExecuteResult,
  ItemResult,
  PermissionStatus,
  PlanSelection,
  Rule,
  RunSummary,
  UndoItemResult,
  WalkProgress,
} from '@diskwise/core/types';

export interface ServerEngine {
  audit(opts: {
    signal: AbortSignal;
    onProgress: (p: WalkProgress) => void;
  }): Promise<AuditResult>;
  listRules(): Rule[];
  buildPlan(audit: AuditResult, selection: PlanSelection): CleanupPlan;
  executePlan(
    plan: CleanupPlan,
    opts: {
      apply: boolean;
      confirmedRuleIds: string[];
      signal: AbortSignal;
      onItem: (r: ItemResult) => void;
    },
  ): Promise<ExecuteResult>;
  listRuns(): Promise<RunSummary[]>;
  undoRun(runId: string): Promise<UndoItemResult[]>;
  appReports(opts: { signal: AbortSignal }): Promise<AppReport[]>;
  // PNG icon drawn from the app bundle at the given bundle id, if it exists.
  appIcon(bundleId: string): Promise<Buffer | undefined>;
  buildAppPlan(report: AppReport, opts?: BuildAppPlanOptions): Promise<CleanupPlan>;
  permissions(): Promise<PermissionStatus>;
  quitApp(bundleId: string): Promise<{ quit: boolean }>;
  version: string;
}
