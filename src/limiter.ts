import { config } from './config.js';
import { Semaphore } from './queue.js';

/**
 * Shared concurrency limiter for all Archi operations.
 * Bounds the number of concurrent Archi JVM instances (user runs and
 * server-driven exports) according to `ARCHI_MAX_CONCURRENCY`.
 */
export const runLimiter = new Semaphore(config.maxConcurrency);
