/**
 * Minimal FIFO semaphore used to bound the number of concurrent operations.
 *
 * Used to limit concurrent Archi runs (JVM instances) to prevent resource exhaustion.
 * Each acquire() returns a release function that must be called to free the slot.
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

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
   * @returns A function that releases the acquired slot. Must be called exactly once.
   */
  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      return this.release();
    }

    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });

    return this.release();
  }

  /**
   * Creates a release function for the currently acquired slot.
   * The release function is idempotent - calling it multiple times has no effect.
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
        // Transfer the slot directly to the next waiter without incrementing available
        nextWaiter();
      } else {
        // No waiters, release the slot back to the pool
        this.available += 1;
      }
    };
  }
}
