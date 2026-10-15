import os from 'node:os';
import path from 'node:path';

/**
 * Parse string environment variable with fallback.
 */
export function parseString(name: string, fallback: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }
  return value;
}

/**
 * Parse positive integer environment variable with fallback.
 * Throws if value is not a positive integer.
 */
export function parsePositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer, got "${raw}"`);
  }
  return parsed;
}

/**
 * Parse boolean environment variable (expects 'true'/'false').
 */
export function parseBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return fallback;
  }
  return value.toLowerCase() === 'true';
}

const home = process.env.HOME ?? os.homedir();
const archiHome = parseString('ARCHI_HOME', '/opt/archi');

export const config = {
  host: parseString('HOST', '0.0.0.0'),
  port: parsePositiveInt('PORT', 3000),

  /** Archi installation root (contains the `Archi` launcher and `plugins/`). */
  archiHome,
  /** Path to the Archi binary. */
  archiBinary: parseString('ARCHI_BINARY', path.join(archiHome, 'Archi')),

  /** Mounted volume: jArchi user scripts folder (used as CommonJS root). */
  scriptsDir: parseString('ARCHI_SCRIPTS_DIR', '/scripts'),
  /** Mounted volume: coArchi model repositories / `.archimate` models. */
  modelsDir: parseString('ARCHI_MODELS_DIR', '/models'),
  /** Scratch dir for per-run working directories. */
  runsDir: parseString('ARCHI_RUNS_DIR', '/var/archi/runs'),

  /** Git binary used for repository management. */
  gitBinary: parseString('GIT_BINARY', 'git'),
  /** Timeout for a single git operation (clone/fetch/merge). */
  gitTimeoutMs: parsePositiveInt('ARCHI_GIT_TIMEOUT_MS', 300_000),
  /** Askpass helper that feeds the access token to git without exposing it in argv. */
  gitAskPass: parseString('ARCHI_GIT_ASKPASS', '/usr/local/bin/git-askpass.sh'),

  /** Hard limit for a single Archi invocation. */
  timeoutMs: parsePositiveInt('ARCHI_TIMEOUT_MS', 120_000),
  /** Number of Archi runs allowed in parallel. Each run is a JVM + X display. */
  maxConcurrency: parsePositiveInt('ARCHI_MAX_CONCURRENCY', 1),
  /** How long a request may wait for a run slot before returning 503. */
  queueTimeoutMs: parsePositiveInt('ARCHI_QUEUE_TIMEOUT_MS', 120_000),
  /** Max number of requests allowed to wait for a run slot (503 beyond this). */
  maxQueueLength: parsePositiveInt('ARCHI_MAX_QUEUE_LENGTH', 100),
  /** Max result file size returned to the caller (base64 inflated). */
  resultMaxBytes: parsePositiveInt('ARCHI_RESULT_MAX_BYTES', 25 * 1024 * 1024),

  /** Optional shared secret. When set, requests must send `x-api-key`. */
  apiKey: parseString('API_KEY', ''),

  /** Log level: debug | info | warn | error. */
  logLevel: parseString('LOG_LEVEL', 'info'),
  /** Keep per-run directories for debugging. */
  keepRunDirs: parseBoolean('ARCHI_KEEP_RUN_DIRS', false),
  /** User home directory. */
  home,
} as const;

export type Config = typeof config;
