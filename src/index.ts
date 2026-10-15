import { mkdir } from 'node:fs/promises';

import { config } from './config.js';
import { log } from './logger.js';
import { createApp } from './server.js';

/**
 * Initialize and start the archi-server HTTP API.
 */
async function main(): Promise<void> {
  // Ensure runs directory exists
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

  /**
   * Graceful shutdown handler.
   */
  const shutdown = (signal: string): void => {
    log.info('shutting down', { signal });
    server.close(() => {
      process.exit(0);
    });
    // Force exit after 10 seconds if graceful shutdown fails
    setTimeout(() => {
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Start the server
main().catch((error: unknown) => {
  log.error('fatal startup error', { error: String(error) });
  process.exit(1);
});
