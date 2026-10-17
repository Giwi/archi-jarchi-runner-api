import { config } from './config.js';
import { HttpError } from './errors.js';
import { QueueFullError, QueueTimeoutError, Semaphore } from './queue.js';

/**
 * Shared concurrency limiter for all Archi operations.
 * Bounds the number of concurrent Archi JVM instances (user runs and
 * server-driven exports) according to `ARCHI_MAX_CONCURRENCY`.
 */
export const runLimiter = new Semaphore(config.maxConcurrency);

/**
 * Shared concurrency limiter for git subprocesses (clone/fetch/merge and the
 * metadata reads behind listing). Independent of the run limiter, so a burst of
 * repository operations cannot fork unbounded `git` processes.
 */
export const gitLimiter = new Semaphore(config.gitMaxConcurrency);

/**
 * Acquire an Archi run slot, translating queue saturation into a 503 so
 * callers get a clear "try again later" instead of an opaque timeout or hang.
 */
export async function acquireRunSlot(): Promise<() => void> {
  try {
    return await runLimiter.acquire({
      timeoutMs: config.queueTimeoutMs,
      maxQueueLength: config.maxQueueLength,
    });
  } catch (error) {
    if (error instanceof QueueTimeoutError || error instanceof QueueFullError) {
      throw new HttpError(503, 'server is busy; try again later');
    }
    throw error;
  }
}
