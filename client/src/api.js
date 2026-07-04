const BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

let memberId = '';
export function setMember(id) { memberId = id || ''; }

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(memberId ? { 'X-Member-Id': memberId } : {}),
      ...(opts.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `Ошибка ${res.status}`);
  return body;
}

export const api = {
  get: (p) => req(p),
  post: (p, d) => req(p, { method: 'POST', body: JSON.stringify(d) }),
  put: (p, d) => req(p, { method: 'PUT', body: JSON.stringify(d) }),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Polls a scan/merge job until done; calls onProgress(job) each tick.
export async function pollJob(jobId, onProgress, shouldCancel) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (shouldCancel?.()) return null;
    const job = await api.get(`/api/jobs/${jobId}`);
    onProgress?.(job);
    if (job.status === 'done') return job;
    if (job.status === 'error') throw new Error(job.error || 'Ошибка задачи');
    await sleep(1500);
  }
}
