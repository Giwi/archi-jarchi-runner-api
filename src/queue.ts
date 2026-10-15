/**
 * Minimal FIFO semaphore used to bound the number of concurrent operations.
 *
 * Used to limit concurrent Archi runs (JVM instances) to prevent resource
 * exhaustion. Each acquire() returns a release function that must be called to
 * free the slot.
 */

/** Error thrown when a slot cannot be acquired within the configured timeout. */
export class QueueTimeoutError extends Error {
  constructor() {
    super('timed out waiting for a semaphore slot');
    this.name = 'QueueTimeoutError';
  }
}

/** Error thrown when the semaphore wait queue is already at capacity. */
export class QueueFullError extends Error {
  constructor() {
    super('semaphore wait queue is full');
    this.name = 'QueueFullError';
  }
}

export interface AcquireOptions {
  /** Reject with {@link QueueTimeoutError} after this many milliseconds. */
  timeoutMs?: number;
  /** Reject with {@link QueueFullError} when the wait queue reaches this size. */
  maxQueueLength?: number;
}

interface Waiter {
  resolve: () => void;
  timer?: NodeJS.Timeout;
}

export class Semaphore {
  private available: number;
  private readonly waiters: Waiter[] = [];

  constructor(size: number) {
    if (size < 1) {
      throw new Error('Semaphore size must be >= 1');
    }
    this.available = size;
  }

  /**
   * Acquire a semaphore slot. If available, returns immediately with a release
   * function. If not, waits for the next available slot in FIFO order.
   *
   * @param options Optional timeout and queue-depth limits.
   * @returns A release function. Must be called exactly once.
   */
  async acquire(options: AcquireOptions = {}): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      return this.release();
    }

    if (
      options.maxQueueLength !== undefined &&
      this.waiters.length >= options.maxQueueLength
    ) {
      throw new QueueFullError();
    }

    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve };

      if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index !== -1) {
            this.waiters.splice(index, 1);
          }
          reject(new QueueTimeoutError());
        }, options.timeoutMs);
      }

      this.waiters.push(waiter);
    });

    return this.release();
  }

  /**
   * Creates an idempotent release function for the currently acquired slot.
   */
  private release(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;

      const nextWaiter = this.waiters.shift();
      if (nextWaiter) {
        // Hand the slot directly to the next waiter without touching `available`.
        if (nextWaiter.timer) {
          clearTimeout(nextWaiter.timer);
        }
        nextWaiter.resolve();
      } else {
        // No waiters; return the slot to the pool.
        this.available += 1;
      }
    };
  }
}
