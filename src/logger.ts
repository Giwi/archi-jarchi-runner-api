import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const level = (config.logLevel in LEVELS ? config.logLevel : 'info') as Level;
const threshold = LEVELS[level];

function emit(level: Level, message: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold) return;
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...fields,
  };
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

export const log = {
  debug: (message: string, fields?: Record<string, unknown>) => emit('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => emit('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit('error', message, fields),
};
