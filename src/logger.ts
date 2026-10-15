import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

/**
 * Parse and normalize log level from configuration.
 */
const configuredLevel = config.logLevel;
const level: Level = configuredLevel in LEVELS ? (configuredLevel as Level) : 'info';
const threshold = LEVELS[level];

/**
 * Emit a structured JSON log entry to stdout.
 */
function emit(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold) {
    return;
  }
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...fields,
  };
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

/**
 * Structured logger with JSON output.
 */
export const log = {
  debug: (message: string, fields?: Record<string, unknown>): void => emit('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>): void => emit('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>): void => emit('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>): void => emit('error', message, fields),
};
