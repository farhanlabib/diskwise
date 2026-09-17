import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type {
  AppReport,
  AuditResult,
  CleanupPlan,
  ExecuteResult,
  ItemResult,
  PermissionStatus,
  PlanSelection,
  RunSummary,
  UndoItemResult,
} from '@diskwise/core/types';
import { api, streamJob, useMock } from './client';
import { createStore } from './store';
import { audit as mockAudit, history as mockHistory, permissions as mockPermissions } from '../mock/data';
import { appReportsForMock } from '../mock/api';

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// ---------------------------------------------------------------------------
// Scan

export interface ScanProgress {
  entries: number;
  path: string;
}

export type ScanState = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

interface ScanSnapshot {
  state: ScanState;
  progress?: ScanProgress;
  audit?: AuditResult;
  jobId?: string;
  error?: string;
}

const scanStore = createStore<ScanSnapshot>(
  useMock ? { state: 'done', audit: mockAudit } : { state: 'idle' },
);

let scanController: AbortController | undefined;

function handleScanEvent(event: { event: string; data: unknown }): void {
  if (event.event === 'progress') {
    scanStore.update((snapshot) => ({
      ...snapshot,
      state: 'running',
      progress: event.data as ScanProgress,
    }));
  } else if (event.event === 'done') {
    scanStore.update((snapshot) => ({
      ...snapshot,
      state: 'done',
      audit: event.data as AuditResult,
      progress: undefined,
    }));
  } else if (event.event === 'error') {
    scanStore.update((snapshot) => ({
      ...snapshot,
      state: snapshot.state === 'cancelled' ? 'cancelled' : 'failed',
      error: errorText(event.data),
    }));
  }
}

async function startScan(): Promise<void> {
  if (useMock) return;
  if (scanStore.get().state === 'running') return;
  scanController?.abort();
  const controller = new AbortController();
  scanController = controller;
  scanStore.set({ state: 'running' });
  try {
    const { jobId } = await api.post<{ jobId: string }>('/api/scans');
    scanStore.update((snapshot) => ({ ...snapshot, jobId }));
    await streamJob(jobId, handleScanEvent, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      scanStore.update((snapshot) => ({ ...snapshot, state: 'cancelled' }));
    } else {
      scanStore.update((snapshot) => ({ ...snapshot, state: 'failed', error: errorText(error) }));
    }
  }
}

async function cancelScan(): Promise<void> {
  if (useMock) return;
  const { jobId } = scanStore.get();
  scanStore.update((snapshot) => ({ ...snapshot, state: 'cancelled' }));
  scanController?.abort();
  scanController = undefined;
  if (jobId) {
    try {
      await api.post(`/api/jobs/${encodeURIComponent(jobId)}/cancel`);
    } catch {
      /* job may already be gone */
    }
  }
}

export function useScan() {
  const snapshot = useSyncExternalStore(scanStore.subscribe, scanStore.get);
  const start = useCallback(() => {
    void startScan();
  }, []);
  const cancel = useCallback(() => {
    void cancelScan();
  }, []);
  return { ...snapshot, start, cancel };
}

// ---------------------------------------------------------------------------
// App scan

interface AppScanSnapshot {
  state: ScanState;
  reports?: AppReport[];
  jobId?: string;
  error?: string;
}

const appScanStore = createStore<AppScanSnapshot>(
  useMock ? { state: 'done', reports: appReportsForMock() } : { state: 'idle' },
);

let appScanController: AbortController | undefined;

async function startAppScan(): Promise<void> {
  if (useMock) return;
  if (appScanStore.get().state === 'running') return;
  appScanController?.abort();
  const controller = new AbortController();
  appScanController = controller;
  appScanStore.set({ state: 'running' });
  try {
    const { jobId } = await api.post<{ jobId: string }>('/api/app-scans');
    appScanStore.update((snapshot) => ({ ...snapshot, jobId }));
    await streamJob(
      jobId,
      (event) => {
        if (event.event === 'done') {
          appScanStore.update((snapshot) => ({
            ...snapshot,
            state: 'done',
            reports: event.data as AppReport[],
          }));
        } else if (event.event === 'error') {
          appScanStore.update((snapshot) => ({
            ...snapshot,
            state: snapshot.state === 'cancelled' ? 'cancelled' : 'failed',
            error: errorText(event.data),
          }));
        }
      },
      controller.signal,
    );
  } catch (error) {
    if (controller.signal.aborted) {
      appScanStore.update((snapshot) => ({ ...snapshot, state: 'cancelled' }));
    } else {
      appScanStore.update((snapshot) => ({ ...snapshot, state: 'failed', error: errorText(error) }));
    }
  }
}

async function cancelAppScan(): Promise<void> {
  if (useMock) return;
  const { jobId } = appScanStore.get();
  appScanStore.update((snapshot) => ({ ...snapshot, state: 'cancelled' }));
  appScanController?.abort();
  appScanController = undefined;
  if (jobId) {
    try {
      await api.post(`/api/jobs/${encodeURIComponent(jobId)}/cancel`);
    } catch {
      /* job may already be gone */
    }
  }
}

export function useAppScan() {
  const snapshot = useSyncExternalStore(appScanStore.subscribe, appScanStore.get);
  const start = useCallback(() => {
    void startAppScan();
  }, []);
  const cancel = useCallback(() => {
    void cancelAppScan();
  }, []);
  return { ...snapshot, start, cancel };
}

// ---------------------------------------------------------------------------
// Permissions

export function usePermissions(): PermissionStatus | null {
  const [status, setStatus] = useState<PermissionStatus | null>(useMock ? mockPermissions : null);

  useEffect(() => {
    if (useMock) return;
    let active = true;
    api
      .get<PermissionStatus>('/api/permissions')
      .then((value) => {
        if (active) setStatus(value);
      })
      .catch(() => {
        /* surface nothing; onboarding falls back to defaults */
      });
    return () => {
      active = false;
    };
  }, []);

  return status;
}

// ---------------------------------------------------------------------------
// Runs

const mockRuns: RunSummary[] = mockHistory.map((run) => ({
  runId: run.id,
  planId: `plan-${run.id}`,
  startedAt: new Date().toISOString(),
  apply: true,
  itemCount: run.items,
  freed: run.freedBytes,
  restorableCount: run.undoable ? 1 : 0,
  incomplete: false,
}));

export function useRuns() {
  const [runs, setRuns] = useState<RunSummary[]>(useMock ? mockRuns : []);

  const refresh = useCallback(() => {
    if (useMock) return;
    api
      .get<RunSummary[]>('/api/runs')
      .then(setRuns)
      .catch(() => {
        /* keep the previous list */
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { runs, refresh };
}

export async function undo(runId: string): Promise<UndoItemResult[]> {
  if (useMock) return [];
  const { results } = await api.post<{ results: UndoItemResult[] }>(
    `/api/runs/${encodeURIComponent(runId)}/undo`,
  );
  return results;
}

// ---------------------------------------------------------------------------
// Execution

export type ExecutionState = 'idle' | 'running' | 'done' | 'failed';

interface ExecutionSnapshot {
  state: ExecutionState;
  results: ItemResult[];
  result?: ExecuteResult;
  error?: string;
}

const executionStore = createStore<ExecutionSnapshot>({ state: 'idle', results: [] });

let executionController: AbortController | undefined;

export interface RunOptions {
  apply: boolean;
  itemIds?: string[];
  confirmedRuleIds: string[];
}

async function runExecution(planId: string, options: RunOptions): Promise<void> {
  if (useMock) return;
  executionController?.abort();
  const controller = new AbortController();
  executionController = controller;
  executionStore.set({ state: 'running', results: [] });
  try {
    const { jobId } = await api.post<{ jobId: string }>('/api/executions', {
      planId,
      itemIds: options.itemIds,
      apply: options.apply,
      confirmedRuleIds: options.confirmedRuleIds,
    });
    await streamJob(
      jobId,
      (event) => {
        if (event.event === 'item') {
          const item = event.data as ItemResult;
          executionStore.update((snapshot) => ({
            ...snapshot,
            results: [...snapshot.results, item],
          }));
        } else if (event.event === 'done') {
          executionStore.update((snapshot) => ({
            ...snapshot,
            state: 'done',
            result: event.data as ExecuteResult,
          }));
        } else if (event.event === 'error') {
          executionStore.update((snapshot) => ({
            ...snapshot,
            state: 'failed',
            error: errorText(event.data),
          }));
        }
      },
      controller.signal,
    );
  } catch (error) {
    if (controller.signal.aborted) return;
    executionStore.update((snapshot) => ({ ...snapshot, state: 'failed', error: errorText(error) }));
  }
}

export function useExecution() {
  const snapshot = useSyncExternalStore(executionStore.subscribe, executionStore.get);
  const run = useCallback((planId: string, options: RunOptions) => {
    void runExecution(planId, options);
  }, []);
  return { ...snapshot, run };
}

// ---------------------------------------------------------------------------
// Actions

export function createPlan(scanJobId: string, selection: PlanSelection): Promise<CleanupPlan> {
  return api.post<CleanupPlan>('/api/plans', { scanJobId, selection });
}

export function createAppPlan(appScanJobId: string, bundleId: string): Promise<CleanupPlan> {
  return api.post<CleanupPlan>('/api/app-plans', { appScanJobId, bundleId });
}

export async function quitApp(bundleId: string): Promise<void> {
  await api.post(`/api/apps/${encodeURIComponent(bundleId)}/quit`);
}

export async function shutdown(): Promise<void> {
  if (useMock) return;
  await api.post('/api/shutdown');
}
