const DEFAULT_WORKER_URL = "https://image-task-worker.royal-silence-b1e6.workers.dev";

export const WORKER_URL = trimTrailingSlash(import.meta.env.VITE_WORKER_URL || DEFAULT_WORKER_URL);

export function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}
