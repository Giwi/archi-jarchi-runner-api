import { config } from './config.js';
import { Semaphore } from './queue.js';

/**
 * Shared limiter for every task that starts an Archi JVM (user runs and
 * server-driven exports), so `ARCHI_MAX_CONCURRENCY` bounds them all together.
 */
export const runLimiter = new Semaphore(config.maxConcurrency);
