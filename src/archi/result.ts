import path from 'node:path';
import { open, stat } from 'node:fs/promises';

import type { ResultEncoding, ResultPayload } from '../types.js';

/** Keys a script may use to advertise the file it wants returned. */
const RESULT_KEYS = ['resultFile', 'result_file', 'result'];

/**
 * Walk the text and yield every balanced `{ ... }` JSON-looking substring.
 * Tolerant of pretty-printed, multi-line JSON while ignoring braces inside strings.
 */
function* jsonCandidates(text: string): Generator<string> {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') {
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          yield text.slice(i, j + 1);
          i = j;
          break;
        }
      }
    }
  }
}

/**
 * Find the path of a result file advertised on stdout. Accepts a JSON object
 * exposing one of {@link RESULT_KEYS} as a string.
 */
export function findResultFile(stdout: string): string | null {
  for (const candidate of jsonCandidates(stdout)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      continue;
    }

    for (const key of RESULT_KEYS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'string' && value.trim() !== '') {
        return value.trim();
      }
    }
  }
  return null;
}

function decodeUtf8(buffer: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

/**
 * Resolve an advertised result-file path against the run directory and ensure
 * it stays inside. Returns the absolute path, or `null` when the path escapes
 * the run directory. Rejecting escapes prevents a script from exfiltrating
 * arbitrary files readable by the server process.
 */
export function resolveResultPath(runDir: string, advertised: string): string | null {
  const resolved = path.resolve(runDir, advertised);
  const relative = path.relative(runDir, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return resolved;
}

/**
 * Read a potentially large file into a bounded buffer.
 */
async function readBounded(
  file: string,
  maxBytes: number,
): Promise<{ data: Buffer; size: number }> {
  const info = await stat(file);
  const toRead = Math.min(info.size, maxBytes);
  const handle = await open(file, 'r');
  try {
    const data = Buffer.allocUnsafe(toRead);
    const { bytesRead } = await handle.read(data, 0, toRead, 0);
    return { data: data.subarray(0, bytesRead), size: info.size };
  } finally {
    await handle.close();
  }
}

/**
 * Read the result file referenced by a script and classify its content as
 * JSON, UTF-8 text, or base64 binary.
 */
export async function readResult(file: string, maxBytes: number): Promise<ResultPayload> {
  const { data, size } = await readBounded(file, maxBytes);
  const truncated = size > data.length;

  let encoding: ResultEncoding = 'base64';
  let content: unknown = data.toString('base64');

  if (!truncated || data.length > 0) {
    const text = decodeUtf8(data);
    if (text !== null) {
      try {
        content = JSON.parse(text);
        encoding = 'json';
      } catch {
        content = text;
        encoding = 'utf8';
      }
    }
  }

  return { file, encoding, content, size, truncated };
}
