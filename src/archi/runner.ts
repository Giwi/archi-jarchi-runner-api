import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { config } from '../config.js';
import { HttpError } from '../errors.js';
import { log } from '../logger.js';
import { errorMessage, runProcess, type ProcessResult } from '../subprocess.js';
import type { RunRequestBody, RunResult, RunScriptRequest } from '../types.js';
import { findResultFile, readResult, resolveResultPath } from './result.js';

interface ResolvedModel {
  path: string;
  mode: 'repo' | 'file';
}

/**
 * Resolve the `model` field to an absolute path inside the models volume and
 * decide whether it is a coArchi repository folder or a plain `.archimate` file.
 */
async function resolveModel(model: string): Promise<ResolvedModel> {
  const trimmed = model.trim();
  if (!trimmed) {
    throw new HttpError(400, 'model must be a non-empty string');
  }

  const base = path.resolve(config.modelsDir);
  const absolute = path.resolve(base, trimmed);
  const relative = path.relative(base, absolute);

  // Ensure the resolved path stays within the models directory
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new HttpError(400, 'model must reference a path inside the models volume');
  }

  let info;
  try {
    info = await stat(absolute);
  } catch {
    throw new HttpError(404, `model not found: ${trimmed}`);
  }

  if (info.isDirectory()) {
    return { path: absolute, mode: 'repo' };
  }
  if (info.isFile()) {
    return { path: absolute, mode: 'file' };
  }
  throw new HttpError(400, `model path is neither a file nor a directory: ${trimmed}`);
}

/**
 * Prelude injected in front of every user script. Exposes a small helper so
 * scripts can publish a result without hard-coding paths, plus any options the
 * server wants to pass through.
 */
function buildPrelude(
  runDir: string,
  correlationId: string,
  options: Record<string, unknown> = {},
): string {
  const resultFile = path.join(runDir, 'result.json');
  const quote = (value: unknown) => JSON.stringify(value);
  return [
    '// archi-server prelude (auto-generated, do not edit)',
    'var archiServer = {',
    `  correlationId: ${quote(correlationId)},`,
    `  runDir: ${quote(runDir)},`,
    `  resultFile: ${quote(resultFile)},`,
    `  options: ${quote(options)},`,
    '  setResult: function (value) {',
    '    jArchi.fs.writeFile(archiServer.resultFile, JSON.stringify(value));',
    '    console.log(JSON.stringify({ resultFile: archiServer.resultFile }));',
    '  }',
    '};',
    '// archi-server prelude end',
    '',
  ].join('\n');
}

/**
 * Build command line arguments for Archi CLI.
 */
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

/**
 * Spawn the Archi CLI process with the given arguments.
 */
async function spawnArchi(args: string[], cwd: string): Promise<ProcessResult> {
  try {
    return await runProcess(config.archiBinary, args, {
      cwd,
      env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':99' },
      timeoutMs: config.timeoutMs,
    });
  } catch (error) {
    throw new HttpError(500, `failed to start Archi: ${errorMessage(error)}`);
  }
}

/**
 * Run an Archi script based on a request body.
 */
export async function runArchi(body: RunRequestBody): Promise<RunResult> {
  return runArchiScript({
    correlationId: body.correlationId,
    model: body.model,
    script: body.script,
  });
}

/**
 * Run an arbitrary jArchi script against a model. Used by both the user-facing
 * `/run` endpoint and server-provided scripts (e.g. the Mermaid exporter).
 */
export async function runArchiScript(request: RunScriptRequest): Promise<RunResult> {
  const { correlationId, script, options } = request;
  const model = await resolveModel(request.model);
  await mkdir(config.runsDir, { recursive: true });

  const runDir = await mkdtemp(path.join(config.runsDir, 'run-'));
  const scriptPath = path.join(runDir, 'script.ajs');
  await writeFile(scriptPath, buildPrelude(runDir, correlationId, options) + script, 'utf8');

  const args = buildArchiArgs(model, scriptPath);
  log.debug('starting archi', { correlationId, model, args });

  const startedAt = Date.now();
  let outcome: ProcessResult;
  try {
    outcome = await spawnArchi(args, runDir);
  } catch (error) {
    if (!config.keepRunDirs) {
      await rm(runDir, { recursive: true, force: true });
    }
    throw error;
  }
  const durationMs = Date.now() - startedAt;

  let result = null;
  const advertised = findResultFile(outcome.stdout);
  if (advertised) {
    const resultPath = resolveResultPath(runDir, advertised);
    if (resultPath) {
      try {
        result = await readResult(resultPath, config.resultMaxBytes);
      } catch (error) {
        log.warn('could not read advertised result file', {
          correlationId,
          resultFile: resultPath,
          error: String(error),
        });
      }
    } else {
      log.warn('result file path escapes the run directory; ignoring', {
        correlationId,
        resultFile: advertised,
      });
    }
  }

  if (!config.keepRunDirs) {
    await rm(runDir, { recursive: true, force: true });
  }

  const notes: string[] = [];
  if (outcome.timedOut) {
    notes.push(`run timed out after ${config.timeoutMs} ms and was killed`);
  }
  if (outcome.stdoutTruncated) {
    notes.push('stdout truncated (output exceeded the buffer limit)');
  }
  if (outcome.stderrTruncated) {
    notes.push('stderr truncated (output exceeded the buffer limit)');
  }
  const stderr =
    notes.length > 0
      ? `${outcome.stderr}\n${notes.map((note) => `[archi-server] ${note}`).join('\n')}`
      : outcome.stderr;

  log.info('archi run finished', {
    correlationId,
    exitCode: outcome.exitCode,
    timedOut: outcome.timedOut,
    durationMs,
    hasResult: result !== null,
  });

  return {
    correlationId,
    stdout: outcome.stdout,
    stderr,
    exitCode: outcome.exitCode,
    result,
    timedOut: outcome.timedOut,
  };
}
