import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';

import { findResultFile, readResult, resolveResultPath } from '../src/archi/result.js';

describe('findResultFile', () => {
  test('finds resultFile in mixed stdout', () => {
    const stdout = 'some log\n{"resultFile":"/tmp/r.json"}\nmore log';
    assert.equal(findResultFile(stdout), '/tmp/r.json');
  });

  test('supports result_file and result keys', () => {
    assert.equal(findResultFile('{"result_file":"/a"}'), '/a');
    assert.equal(findResultFile('{"result":"/b"}'), '/b');
  });

  test('handles pretty-printed multi-line JSON', () => {
    const stdout = '{\n  "resultFile": "/multi/line"\n}\n';
    assert.equal(findResultFile(stdout), '/multi/line');
  });

  test('ignores non-JSON braces and returns null when no key present', () => {
    assert.equal(findResultFile('not json { at all'), null);
    assert.equal(findResultFile('{"other":"value"}'), null);
    assert.equal(findResultFile(''), null);
  });
});

describe('resolveResultPath', () => {
  test('resolves relative and absolute paths inside the run dir', () => {
    const runDir = path.join('/runs', 'run-1');
    assert.equal(resolveResultPath(runDir, 'result.json'), path.join(runDir, 'result.json'));
    assert.equal(
      resolveResultPath(runDir, path.join(runDir, 'result.json')),
      path.join(runDir, 'result.json'),
    );
  });

  test('rejects paths that escape the run dir', () => {
    const runDir = path.join('/runs', 'run-1');
    assert.equal(resolveResultPath(runDir, '../etc/passwd'), null);
    assert.equal(resolveResultPath(runDir, '/etc/passwd'), null);
    assert.equal(resolveResultPath(runDir, '.'), null);
  });
});

describe('readResult', () => {
  let dir: string;

  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'archi-result-'));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('decodes JSON content', async () => {
    const file = path.join(dir, 'result.json');
    await writeFile(file, '{"count": 3}', 'utf8');
    const result = await readResult(file, 1024);
    assert.equal(result.encoding, 'json');
    assert.deepEqual(result.content, { count: 3 });
    assert.equal(result.size, '{"count": 3}'.length);
    assert.equal(result.truncated, false);
  });

  test('falls back to utf8 for plain text', async () => {
    const file = path.join(dir, 'result.txt');
    await writeFile(file, 'hello world', 'utf8');
    const result = await readResult(file, 1024);
    assert.equal(result.encoding, 'utf8');
    assert.equal(result.content, 'hello world');
  });

  test('falls back to base64 for non-utf8 binary', async () => {
    const file = path.join(dir, 'result.bin');
    const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x01]);
    await writeFile(file, bytes);
    const result = await readResult(file, 1024);
    assert.equal(result.encoding, 'base64');
    assert.equal(result.content, bytes.toString('base64'));
  });

  test('truncates content beyond maxBytes and reports it', async () => {
    const file = path.join(dir, 'big.txt');
    await writeFile(file, 'x'.repeat(100), 'utf8');
    const result = await readResult(file, 10);
    assert.equal(result.truncated, true);
    assert.equal(result.size, 100);
    assert.equal((result.content as string).length, 10);
  });
});
