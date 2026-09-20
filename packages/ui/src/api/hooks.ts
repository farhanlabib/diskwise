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
import { ApiError, api, streamJob, useMock } from './client';
import { createStore } from './store';
import { audit as mockAudit, history as mockHistory, permissions as mockPermissions } from '../mock/data';
import { appReportsForMock } from '../mock/api';

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// Turns raw API failures into user-facing text. Server-provided strings can
// contain filesystem paths, so they travel as optional "detail" that the UI
// only reveals when the user asks for it.
export interface DescribedError {
  message: string;
  detail?: string;
}

const GENERIC_API_MESSAGE = (status: number): string => `Request failed with status ${status}`;

export function describeError(error: unknown): DescribedError {
  if (error instanceof TypeError) {
    return {
      message:
        'Lost contact with the DiskWise server. Restart it with diskwise ui, then try again.',
    };
  }
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return {
        message: 'This session link isn’t valid any more. Start DiskWise again with diskwise ui.',
      };
    }
    if (error.status === 403) {
      return {
        message:
          'DiskWise doesn’t have permission for that. Grant Full Disk Access in System Settings, then try again.',
      };
    }
    if (error.status === 404) {
      return {
        message: 'That item isn’t available any more. Run a fresh scan, then try again.',
      };
    }
    if (error.status === 409) {
      return { message: 'That data is out of date. Run a fresh scan, then try again.' };
    }
    if (error.message && error.message !== GENERIC_API_MESSAGE(error.status)) {
      return { message: 'DiskWise couldn’t complete that.', detail: error.message };
    }
    return {
      message: `DiskWise couldn’t complete that (error ${error.status}). Try again, and restart diskwise ui if it keeps failing.`,
    };
  }
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
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

export function usePermissions(): { status: PermissionStatus | null; error: string | null } {
  const [status, setStatus] = useState<PermissionStatus | null>(useMock ? mockPermissions : null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (useMock) return;
    let active = true;
    api
      .get<PermissionStatus>('/api/permissions')
      .then((value) => {
        if (active) {
          setStatus(value);
          setError(null);
        }
      })
      .catch((err) => {
        if (active) setError(describeError(err).message);
      });
    return () => {
      active = false;
    };
  }, []);

  return { status, error };
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
  const [error, setError] = useState<DescribedError | null>(null);

  const refresh = useCallback(() => {
    if (useMock) return;
    api
      .get<RunSummary[]>('/api/runs')
      .then((next) => {
        setRuns(next);
        setError(null);
      })
      .catch((err) => {
        // Keep the list already on screen and mark it stale instead of blanking it.
        setError(describeError(err));
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { runs, refresh, error };
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
          const executeResult = event.data as ExecuteResult;
          executionStore.update((snapshot) => ({
            ...snapshot,
            state: 'done',
            result: executeResult,
          }));
          // The run changed the disk, so refresh the scan on our own; the
          // Overview and Cleanup screens must never need a "Scan again" press
          // after a cleanup. Dry runs (apply: false) leave the disk untouched.
          if (executeResult.apply) void startScan();
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

export function createAppPlan(
  appScanJobId: string,
  bundleId: string,
  opts?: { includeCleanable?: boolean; includeOrphanData?: boolean },
): Promise<CleanupPlan> {
  return api.post<CleanupPlan>('/api/app-plans', {
    appScanJobId,
    bundleId,
    includeCleanable: opts?.includeCleanable,
    includeOrphanData: opts?.includeOrphanData,
  });
}

export async function quitApp(bundleId: string): Promise<void> {
  await api.post(`/api/apps/${encodeURIComponent(bundleId)}/quit`);
}

export async function shutdown(): Promise<void> {
  if (useMock) return;
  await api.post('/api/shutdown');
}
