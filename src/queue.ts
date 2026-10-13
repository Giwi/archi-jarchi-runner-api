/**
 * Minimal FIFO semaphore used to bound the number of concurrent Archi runs.
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(size: number) {
    if (size < 1) throw new Error('Semaphore size must be >= 1');
    this.available = size;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      return this.release();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    return this.release();
  }

  private release(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) {
        next();
      } else {
        this.available += 1;
      }
    };
  }
}
