import os from 'node:os';
import path from 'node:path';

function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer, got "${raw}"`);
  }
  return parsed;
}

const home = process.env.HOME ?? os.homedir();
const archiHome = str('ARCHI_HOME', '/opt/archi');

export const config = {
  host: str('HOST', '0.0.0.0'),
  port: int('PORT', 3000),

  /** Archi installation root (contains the `Archi` launcher and `plugins/`). */
  archiHome,
  archiBinary: str('ARCHI_BINARY', path.join(archiHome, 'Archi')),

  /** Mounted volume: jArchi user scripts folder (used as CommonJS root). */
  scriptsDir: str('ARCHI_SCRIPTS_DIR', '/scripts'),
  /** Mounted volume: coArchi model repositories / `.archimate` models. */
  modelsDir: str('ARCHI_MODELS_DIR', '/models'),
  /** Scratch dir for per-run working directories. */
  runsDir: str('ARCHI_RUNS_DIR', '/var/archi/runs'),

  /** Git binary used for repository management. */
  gitBinary: str('GIT_BINARY', 'git'),
  /** Timeout for a single git operation (clone/fetch/merge). */
  gitTimeoutMs: int('ARCHI_GIT_TIMEOUT_MS', 300_000),
  /** Askpass helper that feeds the access token to git without exposing it in argv. */
  gitAskPass: str('ARCHI_GIT_ASKPASS', '/usr/local/bin/git-askpass.sh'),

  /** Hard limit for a single Archi invocation. */
  timeoutMs: int('ARCHI_TIMEOUT_MS', 120_000),
  /** Number of Archi runs allowed in parallel. Each run is a JVM + X display. */
  maxConcurrency: int('ARCHI_MAX_CONCURRENCY', 1),
  /** Max result file size returned to the caller (base64 inflated). */
  resultMaxBytes: int('ARCHI_RESULT_MAX_BYTES', 25 * 1024 * 1024),

  /** Optional shared secret. When set, requests must send `x-api-key`. */
  apiKey: str('API_KEY', ''),

  logLevel: str('LOG_LEVEL', 'info'),
  keepRunDirs: str('ARCHI_KEEP_RUN_DIRS', 'false') === 'true',
  home,
} as const;

export type Config = typeof config;
