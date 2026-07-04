import { randomUUID } from 'crypto';

// In-memory job tracking for long-running scans / merge-all runs, so the HTTP
// request returns immediately and the client polls for progress.
// (Single-instance only — move to Redis/Postgres if you scale horizontally.)

export type JobStatus = 'running' | 'done' | 'error';

export interface Job {
  id: string;
  memberId: string;
  kind: 'scan' | 'merge';
  status: JobStatus;
  scanned: number;
  groupsFound: number;
  groups: any[] | null;
  total: number;
  processed: number;
  failed: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

const jobs = new Map<string, Job>();
const TTL_MS = 30 * 60_000;

function sweep() {
  const now = Date.now();
  for (const [id, j] of jobs) if (now - j.updatedAt > TTL_MS) jobs.delete(id);
}

export function createJob(memberId: string, kind: Job['kind']): Job {
  sweep();
  const now = Date.now();
  const job: Job = {
    id: randomUUID(), memberId, kind, status: 'running',
    scanned: 0, groupsFound: 0, groups: null,
    total: 0, processed: 0, failed: 0, error: null,
    createdAt: now, updatedAt: now,
  };
  jobs.set(job.id, job);
  return job;
}

export function updateJob(id: string, patch: Partial<Job>): void {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: Date.now() });
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

// Runs `fn` in the background, marking the job done/error when it settles.
export function runJob(id: string, fn: () => Promise<void>): void {
  fn()
    .then(() => updateJob(id, { status: 'done' }))
    .catch((err) => updateJob(id, { status: 'error', error: err.message }));
}
