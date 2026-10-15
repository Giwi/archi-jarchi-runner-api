import { Router, type NextFunction, type Request, type Response } from 'express';

import { runArchi } from '../archi/runner.js';
import { HttpError } from '../errors.js';
import { acquireRunSlot } from '../limiter.js';
import { log } from '../logger.js';
import type { RunRequestBody } from '../types.js';

/**
 * Parse and validate the request body for running a script.
 */
function parseBody(value: unknown): RunRequestBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'request body must be a JSON object');
  }
  const { correlationId, script, model } = value as Record<string, unknown>;

  if (typeof correlationId !== 'string' || correlationId.trim() === '') {
    throw new HttpError(400, 'correlationId must be a non-empty string');
  }
  if (typeof script !== 'string' || script.trim() === '') {
    throw new HttpError(400, 'script must be a non-empty string');
  }
  if (typeof model !== 'string' || model.trim() === '') {
    throw new HttpError(400, 'model must be a non-empty string');
  }

  return {
    correlationId: correlationId.trim(),
    script: script.trim(),
    model: model.trim(),
  };
}

export const runRouter = Router();

/**
 * Execute a jArchi script against a model.
 */
runRouter.post('/run', async (req: Request, res: Response, next: NextFunction) => {
  let release: (() => void) | undefined;
  try {
    const body = parseBody(req.body);

    release = await acquireRunSlot();
    const result = await runArchi(body);

    const { timedOut, ...payload } = result;
    if (timedOut) {
      log.warn('run timed out', { correlationId: body.correlationId });
    }
    res.status(timedOut ? 504 : 200).json(payload);
  } catch (error) {
    next(error);
  } finally {
    release?.();
  }
});
