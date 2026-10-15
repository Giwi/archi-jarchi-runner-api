import { Router, type NextFunction, type Request, type Response } from 'express';

import { HttpError } from '../errors.js';
import { addRepo, listRepos, removeRepo, syncRepo } from '../git.js';
import type { RepoAddRequest, RepoKind, RepoSyncRequest } from '../types.js';

interface ReposRouterOptions {
  /** Directory holding the git-managed sub-folders. */
  baseDir: string;
  /** URL segment, e.g. `models`. */
  segment: string;
  /** Type of repository. */
  kind: RepoKind;
  /** Key used for the list response envelope. */
  listKey: string;
}

/**
 * Parse an optional string field from a request body.
 * Returns `undefined` when absent; rejects non-string values.
 * (Trimming is left to the downstream validators.)
 */
function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new HttpError(400, `${field} must be a string`);
  }
  return value;
}

/**
 * Parse and validate add repository request body.
 */
function parseAddBody(value: unknown): RepoAddRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'request body must be a JSON object');
  }
  const { url, id, branch, username, token } = value as Record<string, unknown>;
  if (typeof url !== 'string' || url.trim() === '') {
    throw new HttpError(400, 'url must be a non-empty string');
  }
  const body: RepoAddRequest = { url: url.trim() };
  const cleanId = optionalString(id, 'id');
  const cleanBranch = optionalString(branch, 'branch');
  const cleanUsername = optionalString(username, 'username');
  const cleanToken = optionalString(token, 'token');
  if (cleanId !== undefined) {
    body.id = cleanId;
  }
  if (cleanBranch !== undefined) {
    body.branch = cleanBranch;
  }
  if (cleanUsername !== undefined) {
    body.username = cleanUsername;
  }
  if (cleanToken !== undefined) {
    body.token = cleanToken;
  }
  return body;
}

/**
 * Parse and validate sync repository request body.
 */
function parseSyncBody(value: unknown): RepoSyncRequest {
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'request body must be a JSON object');
  }
  const { username, token } = value as Record<string, unknown>;
  const body: RepoSyncRequest = {};
  const cleanUsername = optionalString(username, 'username');
  const cleanToken = optionalString(token, 'token');
  if (cleanUsername !== undefined) {
    body.username = cleanUsername;
  }
  if (cleanToken !== undefined) {
    body.token = cleanToken;
  }
  return body;
}

/**
 * Extract and validate repository ID from path parameters.
 */
function idParam(req: Request): string {
  const id = req.params.id;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new HttpError(400, 'id path parameter is required');
  }
  return id.trim();
}

/**
 * CRUD + sync routes for a set of git-managed repositories.
 * The same handler shape is reused for models and script repositories.
 */
export function createReposRouter(options: ReposRouterOptions): Router {
  const { baseDir, segment, kind, listKey } = options;
  const router = Router();

  // List all repositories.
  router.get(`/${segment}`, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const repos = await listRepos(baseDir, kind);
      res.json({ [listKey]: repos });
    } catch (error) {
      next(error);
    }
  });

  // Clone/add a new repository.
  router.post(`/${segment}`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = parseAddBody(req.body);
      const repo = await addRepo(baseDir, kind, body);
      res.status(201).json(repo);
    } catch (error) {
      next(error);
    }
  });

  // Sync a repository (fetch + fast-forward).
  router.post(`/${segment}/:id/sync`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = parseSyncBody(req.body);
      const repo = await syncRepo(baseDir, kind, idParam(req), body);
      res.json(repo);
    } catch (error) {
      next(error);
    }
  });

  // Remove a repository.
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
