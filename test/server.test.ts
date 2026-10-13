import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

// Configure the app before it is imported (config reads env at load time).
const root = await mkdtemp(path.join(os.tmpdir(), 'archi-server-'));
process.env.API_KEY = 'test-key';
process.env.ARCHI_MODELS_DIR = path.join(root, 'models');
process.env.ARCHI_SCRIPTS_DIR = path.join(root, 'scripts');
process.env.ARCHI_RUNS_DIR = path.join(root, 'runs');
process.env.LOG_LEVEL = 'error';

const { createApp } = await import('../src/server.js');
const { openApiDocument } = await import('../src/openapi.js');

const AUTH = { 'x-api-key': 'test-key' };
const JSON_HEADERS = { ...AUTH, 'content-type': 'application/json' };

let server: Server;
let base: string;

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

interface Reply {
  status: number;
  body: unknown;
}

async function call(pathname: string, init?: RequestInit): Promise<Reply> {
  const response = await fetch(base + pathname, init);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

describe('system endpoints', () => {
  test('GET /health is public', async () => {
    const reply = await call('/health');
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, { status: 'ok' });
  });

  test('GET /openapi.json serves the spec', async () => {
    const reply = await call('/openapi.json');
    assert.equal(reply.status, 200);
    const doc = reply.body as { openapi: string; paths: Record<string, unknown> };
    assert.match(doc.openapi, /^3\./);
    for (const expected of ['/health', '/api/run', '/api/models', '/api/scripts', '/api/models/{id}/sync']) {
      assert.ok(doc.paths[expected], `missing path ${expected}`);
    }
  });

  test('unknown routes return 404', async () => {
    const reply = await call('/nope', { headers: AUTH });
    assert.equal(reply.status, 404);
  });
});

describe('authentication', () => {
  test('rejects /api requests without a key', async () => {
    const reply = await call('/api/models');
    assert.equal(reply.status, 401);
  });

  test('accepts requests with the key', async () => {
    const reply = await call('/api/models', { headers: AUTH });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, { models: [] });
  });
});

describe('run endpoint validation', () => {
  test('rejects a body missing required fields', async () => {
    const reply = await call('/api/run', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ correlationId: 'x' }),
    });
    assert.equal(reply.status, 400);
  });

  test('rejects malformed JSON with 400', async () => {
    const reply = await call('/api/run', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{ not json',
    });
    assert.equal(reply.status, 400);
  });
});

describe('repository endpoints', () => {
  test('lists empty model and script repositories', async () => {
    assert.deepEqual((await call('/api/models', { headers: AUTH })).body, { models: [] });
    assert.deepEqual((await call('/api/scripts', { headers: AUTH })).body, { scripts: [] });
  });

  test('rejects an add without a url', async () => {
    const reply = await call('/api/models', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ id: 'x' }),
    });
    assert.equal(reply.status, 400);
  });

  test('rejects a non-http url', async () => {
    const reply = await call('/api/scripts', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ url: 'git@github.com:org/repo.git' }),
    });
    assert.equal(reply.status, 400);
  });

  test('sync and delete return 404 for unknown ids', async () => {
    assert.equal((await call('/api/models/ghost/sync', { method: 'POST', headers: JSON_HEADERS })).status, 404);
    assert.equal((await call('/api/models/ghost', { method: 'DELETE', headers: AUTH })).status, 404);
    assert.equal((await call('/api/scripts/ghost', { method: 'DELETE', headers: AUTH })).status, 404);
  });
});

describe('openapi document', () => {
  test('every $ref resolves', () => {
    const refs = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
      } else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
          if (key === '$ref' && typeof value === 'string') refs.add(value);
          walk(value);
        }
      }
    };
    walk(openApiDocument);

    const components = (openApiDocument as { components: Record<string, object> }).components;
    for (const ref of refs) {
      const parts = ref.split('/');
      const section = parts[2];
      const name = parts[3];
      assert.ok(section && name, `malformed ref ${ref}`);
      const group = components[section];
      assert.ok(group && typeof group === 'object' && name in group, `unresolved ref ${ref}`);
    }
  });
});
