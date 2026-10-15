import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { after, before, describe, test } from 'node:test';

import { HttpError } from '../src/errors.js';
import {
  addRepo,
  listRepos,
  readCredentials,
  removeRepo,
  sanitizeId,
  syncRepo,
} from '../src/git.js';

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8' }).trim();
}

/** The git-backed suite needs a `git` binary; skip (not cancel) when absent. */
const GIT_AVAILABLE = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const describeWithGit = GIT_AVAILABLE ? describe : describe.skip;

/** Minimal smart-HTTP git server backed by `git http-backend` (CGI). */
function createGitServer(projectRoot: string): Promise<{ server: Server; url: string }> {
  const server = createServer((req: IncomingMessage, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let body = Buffer.alloc(0);
      for await (const chunk of req) body = Buffer.concat([body, chunk as Buffer]);

      const child = spawn('git', ['http-backend'], {
        env: {
          ...process.env,
          GIT_PROJECT_ROOT: projectRoot,
          GIT_HTTP_EXPORT_ALL: '1',
          PATH_INFO: url.pathname,
          QUERY_STRING: url.search.replace(/^\?/, ''),
          REQUEST_METHOD: req.method ?? 'GET',
          CONTENT_TYPE: req.headers['content-type'] ?? '',
          CONTENT_LENGTH: String(body.length),
          REMOTE_ADDR: '127.0.0.1',
        },
      });

      const chunks: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.stdin.end(body);
      await once(child, 'close');

      const output = Buffer.concat(chunks);
      const separator = output.indexOf('\r\n\r\n');
      const head = output.subarray(0, separator).toString('utf8');
      const payload = output.subarray(separator + 4);

      let status = 200;
      const headers: Record<string, string> = {};
      for (const line of head.split('\r\n')) {
        const index = line.indexOf(':');
        if (index < 0) continue;
        const key = line.slice(0, index);
        const value = line.slice(index + 1).trim();
        if (key.toLowerCase() === 'status') status = Number.parseInt(value, 10);
        else headers[key] = value;
      }
      res.writeHead(status, headers);
      res.end(payload);
    })().catch(() => {
      res.writeHead(500);
      res.end('git backend error');
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

describe('sanitizeId', () => {
  test('accepts safe ids', () => {
    assert.equal(sanitizeId('my-model'), 'my-model');
    assert.equal(sanitizeId(' A.b_c-1 '), 'A.b_c-1');
  });

  test('rejects traversal, separators and empty values', () => {
    for (const bad of ['', '  ', '..', '.hidden', 'a/b', 'a\\b', '-lead']) {
      assert.throws(
        () => sanitizeId(bad),
        (error: unknown) => error instanceof HttpError && error.status === 400,
        bad,
      );
    }
  });
});

describe('readCredentials', () => {
  const CREDS_FILE = 'archi-server-credentials.json';

  let root: string;
  let repo: string;

  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'archi-creds-'));
    repo = path.join(root, 'repo');
    await mkdir(path.join(repo, '.git'), { recursive: true });
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const writeCreds = (contents: string): Promise<void> =>
    writeFile(path.join(repo, '.git', CREDS_FILE), contents);

  test('reads valid string credentials', async () => {
    await writeCreds(JSON.stringify({ username: 'u', password: 'p' }));
    assert.deepEqual(await readCredentials(repo), { username: 'u', password: 'p' });
  });

  test('drops non-string fields', async () => {
    await writeCreds(JSON.stringify({ username: 123, password: ['x'] }));
    assert.deepEqual(await readCredentials(repo), {});
  });

  test('keeps valid fields and drops invalid ones', async () => {
    await writeCreds(JSON.stringify({ username: 'u', password: 42 }));
    assert.deepEqual(await readCredentials(repo), { username: 'u' });
  });

  test('returns empty for malformed JSON and non-object roots', async () => {
    await writeCreds('{ not json');
    assert.deepEqual(await readCredentials(repo), {});
    await writeCreds('[1, 2, 3]');
    assert.deepEqual(await readCredentials(repo), {});
  });

  test('returns empty when the file is missing', async () => {
    assert.deepEqual(await readCredentials(path.join(root, 'missing')), {});
  });
});

describeWithGit('repository management (local smart-HTTP git)', () => {
  let root: string;
  let modelsDir: string;
  let projectRoot: string;
  let gitServer: Server;
  let remoteUrl: string;
  let workDir: string;

  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'archi-git-'));
    modelsDir = path.join(root, 'models');
    projectRoot = path.join(root, 'serve');
    workDir = path.join(root, 'work');
    await mkdir(modelsDir, { recursive: true });
    await mkdir(projectRoot, { recursive: true });

    // Upstream bare repository with one commit on `main` (independent of the
    // host's init.defaultBranch, which is `master` on some git versions).
    git(projectRoot, 'init', '--bare', '-q', '-b', 'main', 'upstream.git');
    const bareDir = path.join(projectRoot, 'upstream.git');
    git(bareDir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    await mkdir(workDir, { recursive: true });
    git(workDir, 'init', '-q', '-b', 'main');
    await writeFile(path.join(workDir, 'file.txt'), 'hello\n');
    git(workDir, 'add', '.');
    git(workDir, 'commit', '-q', '-m', 'initial commit');
    git(workDir, 'remote', 'add', 'origin', path.join(projectRoot, 'upstream.git'));
    git(workDir, 'push', '-q', 'origin', 'main');

    const started = await createGitServer(projectRoot);
    gitServer = started.server;
    remoteUrl = `${started.url}/upstream.git`;
  });

  after(async () => {
    await new Promise<void>((resolve) => gitServer.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });

  test('addRepo clones over http', async () => {
    const repo = await addRepo(modelsDir, 'model', { url: remoteUrl, id: 'demo' });
    assert.equal(repo.id, 'demo');
    assert.equal(repo.kind, 'model');
    assert.equal(repo.url, remoteUrl);
    assert.equal(repo.branch, 'main');
    assert.match(repo.commit ?? '', /^[0-9a-f]{40}$/);
    assert.equal(repo.subject, 'initial commit');
    assert.equal(repo.dirty, false);
  });

  test('addRepo derives the id from the url when omitted', async () => {
    const repo = await addRepo(modelsDir, 'model', { url: remoteUrl });
    assert.equal(repo.id, 'upstream');
    await removeRepo(modelsDir, 'model', 'upstream');
  });

  test('addRepo rejects a duplicate id', async () => {
    await assert.rejects(
      addRepo(modelsDir, 'model', { url: remoteUrl, id: 'demo' }),
      (error: unknown) => error instanceof HttpError && error.status === 409,
    );
  });

  test('addRepo rejects non-http urls', async () => {
    for (const url of ['git@github.com:org/repo.git', 'file:///tmp/repo', 'ftp://host/repo.git']) {
      await assert.rejects(
        addRepo(modelsDir, 'model', { url }),
        (error: unknown) => error instanceof HttpError && error.status === 400,
        url,
      );
    }
  });

  test('listRepos returns managed repos only', async () => {
    await mkdir(path.join(modelsDir, 'not-a-repo'));
    const repos = await listRepos(modelsDir, 'model');
    assert.deepEqual(
      repos.map((r) => r.id),
      ['demo'],
    );
  });

  test('listRepos skips git repos with invalid folder names', async () => {
    // A git repo whose folder name breaks the id pattern would previously fail
    // the whole listing; it should now be skipped instead.
    const badDir = path.join(modelsDir, 'My Model');
    await mkdir(badDir);
    git(badDir, 'init', '-q', '-b', 'main');

    const repos = await listRepos(modelsDir, 'model');
    assert.deepEqual(
      repos.map((r) => r.id),
      ['demo'],
    );
  });

  test('syncRepo fast-forwards to the remote', async () => {
    await writeFile(path.join(workDir, 'file.txt'), 'hello again\n');
    git(workDir, 'add', '.');
    git(workDir, 'commit', '-q', '-m', 'second commit');
    git(workDir, 'push', '-q', 'origin', 'main');

    const synced = await syncRepo(modelsDir, 'model', 'demo');
    assert.equal(synced.updated, true);
    assert.equal(synced.subject, 'second commit');
    assert.ok(synced.previousCommit);
    assert.notEqual(synced.commit, synced.previousCommit);
  });

  test('syncRepo refuses a detached HEAD', async () => {
    const target = path.join(modelsDir, 'demo');
    git(target, 'checkout', '-q', '--detach');
    await assert.rejects(
      syncRepo(modelsDir, 'model', 'demo'),
      (error: unknown) => error instanceof HttpError && error.status === 409,
    );
    git(target, 'checkout', '-q', 'main');
  });

  test('sync and remove reject unknown ids', async () => {
    for (const run of [
      () => syncRepo(modelsDir, 'model', 'ghost'),
      () => removeRepo(modelsDir, 'model', 'ghost'),
    ]) {
      await assert.rejects(
        run(),
        (error: unknown) => error instanceof HttpError && error.status === 404,
      );
    }
  });

  test('removeRepo deletes the folder', async () => {
    await removeRepo(modelsDir, 'model', 'demo');
    assert.deepEqual(await listRepos(modelsDir, 'model'), []);
  });
});
