import { Router, type NextFunction, type Request, type Response } from 'express';

import { runMermaidExport } from '../archi/mermaid.js';
import { HttpError } from '../errors.js';
import { acquireRunSlot } from '../limiter.js';
import { log } from '../logger.js';
import type { MermaidDirection, MermaidExportRequest, MermaidExportResponse } from '../types.js';

const DIRECTIONS: readonly MermaidDirection[] = ['LR', 'RL', 'TB', 'BT'];

/**
 * Parse and validate the request body for Mermaid export.
 */
function parseMermaidBody(value: unknown): MermaidExportRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'request body must be a JSON object');
  }
  const { correlationId, model, view, folder, direction, relationships } = value as Record<
    string,
    unknown
  >;

  if (typeof correlationId !== 'string' || correlationId.trim() === '') {
    throw new HttpError(400, 'correlationId must be a non-empty string');
  }
  if (typeof model !== 'string' || model.trim() === '') {
    throw new HttpError(400, 'model must be a non-empty string');
  }

  const request: MermaidExportRequest = {
    correlationId: correlationId.trim(),
    model: model.trim(),
  };

  if (view !== undefined) {
    if (typeof view !== 'string' || view.trim() === '') {
      throw new HttpError(400, 'view must be a non-empty string');
    }
    request.view = view.trim();
  }
  if (folder !== undefined) {
    if (typeof folder !== 'string' || folder.trim() === '') {
      throw new HttpError(400, 'folder must be a non-empty string');
    }
    request.folder = folder.trim();
  }
  if (request.view && request.folder) {
    throw new HttpError(400, 'provide either "view" or "folder", not both');
  }
  if (direction !== undefined) {
    if (typeof direction !== 'string' || !DIRECTIONS.includes(direction as MermaidDirection)) {
      throw new HttpError(400, `direction must be one of ${DIRECTIONS.join(', ')}`);
    }
    request.direction = direction as MermaidDirection;
  }
  if (relationships !== undefined) {
    if (typeof relationships !== 'boolean') {
      throw new HttpError(400, 'relationships must be a boolean');
    }
    request.relationships = relationships;
  }
  return request;
}

export const exportRouter = Router();

/**
 * Export ArchiMate view(s) as Markdown with Mermaid flowcharts.
 */
exportRouter.post('/export/mermaid', async (req: Request, res: Response, next: NextFunction) => {
  let release: (() => void) | undefined;
  try {
    const body = parseMermaidBody(req.body);

    release = await acquireRunSlot();
    const result = await runMermaidExport(body);

    const { timedOut, ...payload } = result;
    const content = (result.result?.content ?? null) as {
      markdown?: unknown;
      error?: unknown;
    } | null;

    if (content && typeof content.error === 'string') {
      throw new HttpError(404, content.error);
    }

    const markdown = content && typeof content.markdown === 'string' ? content.markdown : null;
    if (timedOut) {
      log.warn('mermaid export timed out', { correlationId: body.correlationId });
    }
    const response: MermaidExportResponse = { ...payload, markdown };
    res.status(timedOut ? 504 : 200).json(response);
  } catch (error) {
    next(error);
  } finally {
    release?.();
  }
});
