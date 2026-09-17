import { randomUUID } from 'node:crypto';

export type JobKind = 'scan' | 'execute' | 'apps';
export type JobState = 'running' | 'done' | 'failed' | 'cancelled';

export interface JobEvent {
  event: string;
  data: unknown;
}

export type JobListener = (event: JobEvent) => void;

export interface Job {
  id: string;
  kind: JobKind;
  state: JobState;
  createdAt: number;
  progress?: unknown;
  result?: unknown;
  error?: string;
  controller: AbortController;
  events: JobEvent[];
  listeners: Set<JobListener>;
}

export interface JobContext {
  signal: AbortSignal;
  emit: (event: string, data: unknown) => void;
}

const MAX_EVENTS = 5000;
const MAX_FINISHED = 20;

export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private readonly finishedOrder: string[] = [];

  start(kind: JobKind, fn: (ctx: JobContext) => Promise<unknown>): Job {
    const controller = new AbortController();
    const job: Job = {
      id: randomUUID(),
      kind,
      state: 'running',
      createdAt: Date.now(),
      controller,
      events: [],
      listeners: new Set(),
    };
    this.jobs.set(job.id, job);

    const emit = (event: string, data: unknown): void => {
      if (event === 'progress') job.progress = data;
      const record: JobEvent = { event, data };
      job.events.push(record);
      if (job.events.length > MAX_EVENTS) job.events.shift();
      for (const listener of [...job.listeners]) listener(record);
    };

    Promise.resolve()
      .then(() => fn({ signal: controller.signal, emit }))
      .then(
        (result) => {
          if (controller.signal.aborted) {
            job.state = 'cancelled';
            emit('error', 'cancelled');
          } else {
            job.state = 'done';
            job.result = result;
            emit('done', result);
          }
        },
        (error: unknown) => {
          if (controller.signal.aborted) {
            job.state = 'cancelled';
            emit('error', 'cancelled');
          } else {
            job.state = 'failed';
            job.error = error instanceof Error ? error.message : String(error);
            emit('error', job.error);
          }
        },
      )
      .finally(() => {
        this.finishedOrder.push(job.id);
        while (this.finishedOrder.length > MAX_FINISHED) {
          const oldest = this.finishedOrder.shift();
          if (oldest !== undefined) this.jobs.delete(oldest);
        }
      });

    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.state === 'running') job.controller.abort();
    return true;
  }

  cancelAll(): void {
    for (const job of this.jobs.values()) {
      if (job.state === 'running') job.controller.abort();
    }
  }

  runningOfKind(kind: JobKind): Job | undefined {
    for (const job of this.jobs.values()) {
      if (job.kind === kind && job.state === 'running') return job;
    }
    return undefined;
  }

  subscribe(id: string, listener: JobListener): () => void {
    const job = this.jobs.get(id);
    if (!job) return () => {};
    for (const event of [...job.events]) listener(event);
    if (job.state !== 'running') return () => {};
    job.listeners.add(listener);
    return () => {
      job.listeners.delete(listener);
    };
  }
}
