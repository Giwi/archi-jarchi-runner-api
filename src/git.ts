import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { config } from './config.js';
import { HttpError } from './errors.js';
import { log } from './logger.js';
import type { RepoAddRequest, RepoInfo, RepoKind, RepoSyncRequest } from './types.js';

interface Credentials {
  username?: string;
  password?: string;
}

/** Safe repository id: used verbatim as a single sub-folder name. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const CREDENTIALS_FILE = 'archi-server-credentials.json';

function fail(status: number, message: string, details?: unknown): never {
  throw new HttpError(status, message, details);
}

export function sanitizeId(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    fail(400, 'id must be a non-empty string');
  }
  const id = raw.trim();
  if (!ID_PATTERN.test(id)) {
    fail(400, 'id may only contain letters, digits, ".", "_" and "-"', { id });
  }
  return id;
}

function deriveId(url: string): string {
  const withoutQuery = url.split(/[?#]/, 1)[0] ?? url;
  const last = withoutQuery.replace(/\/+$/, '').split('/').pop() ?? '';
  const candidate = last.replace(/\.git$/i, '');
  if (!ID_PATTERN.test(candidate)) {
    fail(400, 'could not derive an id from the url; pass an explicit "id"', { url });
  }
  return candidate;
}

/** Split `https://user:token@host/path` into a clean url and its credentials. */
function splitCredentials(rawUrl: string): { url: string; credentials: Credentials } {
  try {
    const parsed = new URL(rawUrl);
    if (!parsed.username && !parsed.password) return { url: rawUrl, credentials: {} };
    const credentials: Credentials = {};
    if (parsed.username) credentials.username = decodeURIComponent(parsed.username);
    if (parsed.password) credentials.password = decodeURIComponent(parsed.password);
    parsed.username = '';
    parsed.password = '';
    return { url: parsed.toString(), credentials };
  } catch {
    return { url: rawUrl, credentials: {} };
  }
}

function stripCredentials(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (!parsed.username && !parsed.password) return rawUrl;
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    // scp-like syntax `user@host:path` carries no password.
    return rawUrl;
  }
}

function hasCredentials(credentials: Credentials): boolean {
  return Boolean(credentials.username || credentials.password);
}

/** Only plain HTTP(S) remotes are supported (token auth, no SSH). */
function assertHttpUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    fail(400, 'url must be a valid http(s) git url', { url });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail(400, 'only http(s) git urls are supported', { scheme: parsed.protocol });
  }
}

/** Default username for token auth: `oauth2` is accepted by GitHub and GitLab. */
function effectiveCredentials(
  embedded: Credentials,
  override: { username?: string; token?: string },
): Credentials {
  const username = override.username ?? embedded.username;
  const password = override.token ?? embedded.password;
  if (!username && password) return { username: 'oauth2', password };
  return { username, password };
}

function gitEnv(credentials: Credentials): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (hasCredentials(credentials)) {
    env.ARCHI_GIT_USERNAME = credentials.username ?? '';
    env.ARCHI_GIT_PASSWORD = credentials.password ?? '';
    if (existsSync(config.gitAskPass)) {
      env.GIT_ASKPASS = config.gitAskPass;
      env.SSH_ASKPASS = config.gitAskPass;
      env.SSH_ASKPASS_REQUIRE = 'force';
    }
  }
  return env;
}

interface GitOptions {
  cwd?: string;
  credentials?: Credentials;
}

function runGit(args: string[], options: GitOptions = {}): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(config.gitBinary, args, {
      cwd: options.cwd,
      env: gitEnv(options.credentials ?? {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, config.gitTimeoutMs);

    child.on('error', (error) => {
      finish(() => reject(new HttpError(500, `failed to run git: ${error.message}`)));
    });

    child.on('close', (code) => {
      finish(() => {
        if (timedOut) {
          reject(new HttpError(504, `git ${args[0]} timed out after ${config.gitTimeoutMs} ms`));
        } else if (code !== 0) {
          reject(
            new HttpError(502, `git ${args[0]} failed`, {
              exitCode: code,
              stderr: stderr.trim().slice(-4000),
            }),
          );
        } else {
          resolve(stdout);
        }
      });
    });
  });
}

async function tryGit(args: string[], options: GitOptions = {}): Promise<string | null> {
  try {
    return (await runGit(args, options)).trim();
  } catch {
    return null;
  }
}

function repoDir(baseDir: string, id: string): string {
  const dir = path.join(baseDir, sanitizeId(id));
  const relative = path.relative(baseDir, dir);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(400, 'id must stay inside the managed directory', { id });
  }
  return dir;
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    return (await stat(path.join(dir, '.git'))).isDirectory();
  } catch {
    return false;
  }
}

async function assertRepo(dir: string, id: string, kind: RepoKind): Promise<void> {
  if (!existsSync(dir)) fail(404, `${kind} "${id}" not found`);
  if (!(await isGitRepo(dir))) fail(409, `"${id}" is not a git-managed ${kind}`);
}

async function readCredentials(dir: string): Promise<Credentials> {
  try {
    const raw = await readFile(path.join(dir, '.git', CREDENTIALS_FILE), 'utf8');
    const parsed = JSON.parse(raw) as Credentials;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // no stored credentials
  }
  return {};
}

async function writeCredentials(dir: string, credentials: Credentials): Promise<void> {
  if (!hasCredentials(credentials)) return;
  const file = path.join(dir, '.git', CREDENTIALS_FILE);
  await writeFile(file, JSON.stringify(credentials), { encoding: 'utf8', mode: 0o600 });
  await chmod(file, 0o600).catch(() => undefined);
}

async function buildRepoInfo(baseDir: string, id: string, kind: RepoKind): Promise<RepoInfo> {
  const dir = repoDir(baseDir, id);
  const [url, branch, log, status] = await Promise.all([
    tryGit(['remote', 'get-url', 'origin'], { cwd: dir }),
    tryGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir }),
    tryGit(['log', '-1', '--format=%H%x00%s%x00%cI'], { cwd: dir }),
    tryGit(['status', '--porcelain'], { cwd: dir }),
  ]);

  const [commit, subject, date] = (log ?? '').split('\u0000');
  return {
    id,
    kind,
    path: dir,
    url: url ? stripCredentials(url) : null,
    branch: branch && branch !== 'HEAD' ? branch : null,
    commit: commit || null,
    subject: subject || null,
    date: date || null,
    dirty: Boolean(status && status.length > 0),
  };
}

export async function listRepos(baseDir: string, kind: RepoKind): Promise<RepoInfo[]> {
  let entries;
  try {
    entries = await readdir(baseDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const repos: RepoInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(baseDir, entry.name);
    if (!(await isGitRepo(dir))) continue;
    repos.push(await buildRepoInfo(baseDir, entry.name, kind));
  }
  return repos.sort((a, b) => a.id.localeCompare(b.id));
}

export async function addRepo(
  baseDir: string,
  kind: RepoKind,
  body: RepoAddRequest,
): Promise<RepoInfo> {
  if (typeof body.url !== 'string' || body.url.trim() === '') {
    fail(400, 'url must be a non-empty string');
  }
  const rawUrl = body.url.trim();
  if (rawUrl.startsWith('-')) fail(400, 'url must not start with "-"');
  assertHttpUrl(rawUrl);

  let branch: string | undefined;
  if (body.branch !== undefined) {
    if (typeof body.branch !== 'string' || !BRANCH_PATTERN.test(body.branch.trim())) {
      fail(400, 'branch must be a valid branch name');
    }
    branch = body.branch.trim();
  }

  const { url, credentials: embedded } = splitCredentials(rawUrl);
  const credentials = effectiveCredentials(embedded, {
    username: typeof body.username === 'string' ? body.username : undefined,
    token: typeof body.token === 'string' ? body.token : undefined,
  });

  const id = body.id !== undefined ? sanitizeId(body.id) : deriveId(url);
  await mkdir(baseDir, { recursive: true });
  const dir = repoDir(baseDir, id);

  if (existsSync(dir)) fail(409, `a ${kind} with id "${id}" already exists`);

  const askPassAvailable = existsSync(config.gitAskPass);
  const cloneUrl = hasCredentials(credentials) && !askPassAvailable
    ? embedCredentials(url, credentials)
    : url;
  const args = ['clone', '--quiet'];
  if (branch) args.push('--branch', branch);
  args.push(cloneUrl, dir);

  log.info('cloning repository', { kind, id, url, branch });
  try {
    await runGit(args, { cwd: baseDir, credentials });
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }

  // Never persist credentials in the remote; the sanitized url is stored by git.
  if (cloneUrl !== url) {
    await runGit(['remote', 'set-url', 'origin', url], { cwd: dir }).catch(() => undefined);
  }
  await writeCredentials(dir, credentials);

  return buildRepoInfo(baseDir, id, kind);
}

export interface RepoSyncResult extends RepoInfo {
  updated: boolean;
  previousCommit: string | null;
}

export async function syncRepo(
  baseDir: string,
  kind: RepoKind,
  id: string,
  override: RepoSyncRequest = {},
): Promise<RepoSyncResult> {
  const cleanId = sanitizeId(id);
  const dir = repoDir(baseDir, cleanId);
  await assertRepo(dir, cleanId, kind);

  const stored = await readCredentials(dir);
  const credentials: Credentials = {
    username: override.username ?? stored.username,
    password: override.token ?? stored.password,
  };
  if (!credentials.username && credentials.password) credentials.username = 'oauth2';
  if (override.token || override.username) await writeCredentials(dir, credentials);

  const branch = await tryGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir });
  if (!branch || branch === 'HEAD') {
    fail(409, `${kind} "${cleanId}" is in a detached HEAD state; cannot sync`);
  }

  const previousCommit = await tryGit(['rev-parse', 'HEAD'], { cwd: dir });
  log.info('syncing repository', { kind, id: cleanId, branch });

  await runGit(['fetch', '--prune', 'origin'], { cwd: dir, credentials });
  await runGit(['merge', '--ff-only', `origin/${branch}`], { cwd: dir, credentials });

  const info = await buildRepoInfo(baseDir, cleanId, kind);
  return { ...info, updated: info.commit !== previousCommit, previousCommit: previousCommit ?? null };
}

export async function removeRepo(baseDir: string, kind: RepoKind, id: string): Promise<void> {
  const cleanId = sanitizeId(id);
  const dir = repoDir(baseDir, cleanId);
  await assertRepo(dir, cleanId, kind);
  log.info('removing repository', { kind, id: cleanId });
  await rm(dir, { recursive: true, force: true });
}

function embedCredentials(url: string, credentials: Credentials): string {
  try {
    const parsed = new URL(url);
    parsed.username = encodeURIComponent(credentials.username ?? '');
    parsed.password = encodeURIComponent(credentials.password ?? '');
    return parsed.toString();
  } catch {
    return url;
  }
}
