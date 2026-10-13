import { mkdir } from 'node:fs/promises';

import { config } from './config.js';
import { log } from './logger.js';
import { createApp } from './server.js';

async function main(): Promise<void> {
  await mkdir(config.runsDir, { recursive: true });

  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    log.info('archi-server listening', {
      host: config.host,
      port: config.port,
      archiHome: config.archiHome,
      scriptsDir: config.scriptsDir,
      modelsDir: config.modelsDir,
      maxConcurrency: config.maxConcurrency,
      timeoutMs: config.timeoutMs,
    });
  });

  const shutdown = (signal: string): void => {
    log.info('shutting down', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  log.error('fatal startup error', { error: String(error) });
  process.exit(1);
});
