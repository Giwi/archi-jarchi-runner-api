import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { log } from '../logger.js';
import type { RunRequestBody, RunResult } from '../types.js';
import { findResultFile, readResult } from './result.js';

interface ResolvedModel {
  path: string;
  mode: 'repo' | 'file';
}

interface SpawnOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

/**
 * Resolve the `model` field to an absolute path inside the models volume and
 * decide whether it is a coArchi repository folder or a plain `.archimate` file.
 */
async function resolveModel(model: string): Promise<ResolvedModel> {
  const trimmed = model.trim();
  if (!trimmed) throw new HttpError(400, 'model must be a non-empty string');

  const base = path.resolve(config.modelsDir);
  const absolute = path.resolve(base, trimmed);
  const relative = path.relative(base, absolute);

  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new HttpError(400, 'model must reference a path inside the models volume', {
      modelsDir: base,
    });
  }

  let info;
  try {
    info = await stat(absolute);
  } catch {
    throw new HttpError(404, `model not found: ${trimmed}`, { modelsDir: base });
  }

  if (info.isDirectory()) return { path: absolute, mode: 'repo' };
  if (info.isFile()) return { path: absolute, mode: 'file' };
  throw new HttpError(400, `model path is neither a file nor a directory: ${trimmed}`);
}

/**
 * Prelude injected in front of every user script. Exposes a small helper so
 * scripts can publish a result without hard-coding paths.
 */
function buildPrelude(runDir: string, correlationId: string): string {
  const resultFile = path.join(runDir, 'result.json');
  const quote = (value: unknown) => JSON.stringify(value);
  return [
    '// archi-server prelude (auto-generated, do not edit)',
    'var archiServer = {',
    `  correlationId: ${quote(correlationId)},`,
    `  runDir: ${quote(runDir)},`,
    `  resultFile: ${quote(resultFile)},`,
    '  setResult: function (value) {',
    '    jArchi.fs.writeFile(archiServer.resultFile, JSON.stringify(value));',
    '    console.log(JSON.stringify({ resultFile: archiServer.resultFile }));',
    '  }',
    '};',
    '// archi-server prelude end',
    '',
  ].join('\n');
}

function buildArchiArgs(model: ResolvedModel, scriptPath: string): string[] {
  const args = [
    '-application',
    'com.archimatetool.commandline.app',
    '-consoleLog',
    '-nosplash',
    '-data',
    path.join(path.dirname(scriptPath), 'workspace'),
  ];

  if (model.mode === 'repo') {
    args.push('--modelrepository.loadModel', model.path);
  } else {
    args.push('--loadModel', model.path);
  }

  args.push('--script.runScript', scriptPath);
  return args;
}

function spawnArchi(args: string[], cwd: string): Promise<SpawnOutcome> {
  return new Promise<SpawnOutcome>((resolve, reject) => {
    const child = spawn(config.archiBinary, args, {
      cwd,
      env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' },
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

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, config.timeoutMs);

    const finish = (outcome: SpawnOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new HttpError(500, `failed to start Archi: ${error.message}`));
    });

    child.on('close', (code) => {
      finish({ stdout, stderr, exitCode: code, timedOut });
    });
  });
}

export async function runArchi(body: RunRequestBody): Promise<RunResult> {
  const model = await resolveModel(body.model);
  await mkdir(config.runsDir, { recursive: true });

  const runDir = await mkdtemp(path.join(config.runsDir, 'run-'));
  const scriptPath = path.join(runDir, 'script.ajs');
  await writeFile(scriptPath, buildPrelude(runDir, body.correlationId) + body.script, 'utf8');

  const args = buildArchiArgs(model, scriptPath);
  log.debug('starting archi', { correlationId: body.correlationId, model, args });

  const startedAt = Date.now();
  let outcome: SpawnOutcome;
  try {
    outcome = await spawnArchi(args, runDir);
  } catch (error) {
    if (!config.keepRunDirs) await rm(runDir, { recursive: true, force: true });
    throw error;
  }
  const durationMs = Date.now() - startedAt;

  let result = null;
  const advertised = findResultFile(outcome.stdout);
  if (advertised) {
    const resultPath = path.isAbsolute(advertised)
      ? advertised
      : path.resolve(runDir, advertised);
    try {
      result = await readResult(resultPath, config.resultMaxBytes);
    } catch (error) {
      log.warn('could not read advertised result file', {
        correlationId: body.correlationId,
        resultFile: resultPath,
        error: String(error),
      });
    }
  }

  if (!config.keepRunDirs) {
    await rm(runDir, { recursive: true, force: true });
  }

  const stderr = outcome.timedOut
    ? `${outcome.stderr}\n[archi-server] run timed out after ${config.timeoutMs} ms and was killed`
    : outcome.stderr;

  log.info('archi run finished', {
    correlationId: body.correlationId,
    exitCode: outcome.exitCode,
    timedOut: outcome.timedOut,
    durationMs,
    hasResult: result !== null,
  });

  return {
    correlationId: body.correlationId,
    stdout: outcome.stdout,
    stderr,
    exitCode: outcome.exitCode,
    result,
    timedOut: outcome.timedOut,
  };
}
