import express, { type NextFunction, type Request, type Response } from 'express';

import { config } from './config.js';
import { HttpError, isHttpError } from './errors.js';
import { log } from './logger.js';
import { openApiDocument } from './openapi.js';
import { exportRouter } from './routes/export.js';
import { createReposRouter } from './routes/repos.js';
import { runRouter } from './routes/run.js';

/**
 * Type guard for Express body-parser errors.
 */
function isBodyParserError(error: unknown): error is { status?: number; type: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    typeof (error as { type?: unknown }).type === 'string' &&
    (error as { type: string }).type.startsWith('entity.')
  );
}

/**
 * Create and configure the Express application.
 */
export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));

  // Public health check endpoint.
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // OpenAPI document (public, like /health).
  app.get('/openapi.json', (_req: Request, res: Response) => {
    res.json(openApiDocument);
  });

  // Optional shared-secret authentication middleware.
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (!config.apiKey || req.get('x-api-key') === config.apiKey) {
      next();
      return;
    }
    next(new HttpError(401, 'invalid or missing x-api-key'));
  });

  // API routes.
  app.use('/api', runRouter);
  app.use('/api', exportRouter);

  // Git-managed model repositories (sub-folders of the models volume).
  app.use(
    '/api',
    createReposRouter({
      baseDir: config.modelsDir,
      segment: 'models',
      kind: 'model',
      listKey: 'models',
    }),
  );

  // Git-managed script repositories (sub-folders of the scripts volume).
  app.use(
    '/api',
    createReposRouter({
      baseDir: config.scriptsDir,
      segment: 'scripts',
      kind: 'script',
      listKey: 'scripts',
    }),
  );

  // 404 handler for unmatched routes.
  app.use((_req: Request, _res: Response, next: NextFunction) => {
    next(new HttpError(404, 'not found'));
  });

  // Global error handler.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isBodyParserError(error)) {
      const status = error.status ?? 400;
      res.status(status).json({
        error: status === 413 ? 'request body too large' : 'invalid JSON body',
      });
      return;
    }

    if (isHttpError(error)) {
      res.status(error.status).json({
        error: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      });
      return;
    }

    log.error('unhandled error', {
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}
