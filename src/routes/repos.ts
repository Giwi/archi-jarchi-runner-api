import { Router, type NextFunction, type Request, type Response } from 'express';

import { HttpError } from '../errors.js';
import { addRepo, listRepos, removeRepo, syncRepo } from '../git.js';
import type { RepoAddRequest, RepoKind, RepoSyncRequest } from '../types.js';

interface ReposRouterOptions {
  /** Directory holding the git-managed sub-folders. */
  baseDir: string;
  /** URL segment, e.g. `models`. */
  segment: string;
  kind: RepoKind;
  /** Key used for the list response envelope. */
  listKey: string;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be a string`);
  return value;
}

function parseAddBody(value: unknown): RepoAddRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'request body must be a JSON object');
  }
  const { url, id, branch, username, token } = value as Record<string, unknown>;
  if (typeof url !== 'string' || url.trim() === '') {
    throw new HttpError(400, 'url must be a non-empty string');
  }
  const body: RepoAddRequest = { url };
  const cleanId = optionalString(id, 'id');
  const cleanBranch = optionalString(branch, 'branch');
  const cleanUsername = optionalString(username, 'username');
  const cleanToken = optionalString(token, 'token');
  if (cleanId !== undefined) body.id = cleanId;
  if (cleanBranch !== undefined) body.branch = cleanBranch;
  if (cleanUsername !== undefined) body.username = cleanUsername;
  if (cleanToken !== undefined) body.token = cleanToken;
  return body;
}

function parseSyncBody(value: unknown): RepoSyncRequest {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'request body must be a JSON object');
  }
  const { username, token } = value as Record<string, unknown>;
  const body: RepoSyncRequest = {};
  const cleanUsername = optionalString(username, 'username');
  const cleanToken = optionalString(token, 'token');
  if (cleanUsername !== undefined) body.username = cleanUsername;
  if (cleanToken !== undefined) body.token = cleanToken;
  return body;
}

function idParam(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new HttpError(400, 'id path parameter is required');
  }
  return id;
}

/**
 * CRUD + sync routes for a set of git-managed repositories. The same handler
 * shape is reused for models and script repositories.
 */
export function createReposRouter(options: ReposRouterOptions): Router {
  const { baseDir, segment, kind, listKey } = options;
  const router = Router();

  router.get(`/${segment}`, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ [listKey]: await listRepos(baseDir, kind) });
    } catch (error) {
      next(error);
    }
  });

  router.post(`/${segment}`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = parseAddBody(req.body);
      const repo = await addRepo(baseDir, kind, body);
      res.status(201).json(repo);
    } catch (error) {
      next(error);
    }
  });

  router.post(`/${segment}/:id/sync`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = parseSyncBody(req.body);
      const repo = await syncRepo(baseDir, kind, idParam(req), body);
      res.json(repo);
    } catch (error) {
      next(error);
    }
  });

  router.delete(`/${segment}/:id`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await removeRepo(baseDir, kind, idParam(req));
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
