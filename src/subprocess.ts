import { spawn } from 'node:child_process';

/**
 * Outcome of a finished (or timed-out) child process.
 */
export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  /** True when stdout exceeded its buffer cap and further output was dropped. */
  stdoutTruncated: boolean;
  /** True when stderr exceeded its buffer cap and further output was dropped. */
  stderrTruncated: boolean;
}

export interface RunProcessOptions {
  /** Working directory for the child process. */
  cwd?: string;
  /** Environment for the child process (defaults to `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Kill the process after this many milliseconds. */
  timeoutMs: number;
  /** Cap on buffered stdout bytes; extra output is discarded. */
  stdoutLimitBytes?: number;
  /** Cap on buffered stderr bytes; extra output is discarded. */
  stderrLimitBytes?: number;
}

/** Default output cap to prevent unbounded buffering from runaway processes. */
const DEFAULT_OUTPUT_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB

/** Convert an unknown thrown value to a string message. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Spawn a child process, capture its output (with bounded buffering), and
 * enforce a timeout. Resolves with the process outcome; rejects only when the
 * process could not be started (spawn `error` event). Callers decide how to
 * treat non-zero exit codes and timeouts.
 */
export function runProcess(
  binary: string,
  args: string[],
  options: RunProcessOptions,
): Promise<ProcessResult> {
  const stdoutLimit = options.stdoutLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;
  const stderrLimit = options.stderrLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES;

  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let settled = false;

    // Append to a bounded buffer. Once the cap is hit, further data is dropped
    // and the matching `*Truncated` flag set, avoiding unbounded memory growth.
    const onStdout = (chunk: string): void => {
      if (stdoutTruncated) return;
      const remaining = stdoutLimit - stdout.length;
      if (chunk.length > remaining) {
        stdout += chunk.slice(0, remaining);
        stdoutTruncated = true;
      } else {
        stdout += chunk;
      }
    };

    const onStderr = (chunk: string): void => {
      if (stderrTruncated) return;
      const remaining = stderrLimit - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
      } else {
        stderr += chunk;
      }
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);

    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode, timedOut, stdoutTruncated, stderrTruncated });
    };

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      finish(code);
    });
  });
}
