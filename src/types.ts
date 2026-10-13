export interface RunRequestBody {
  correlationId: string;
  script: string;
  model: string;
}

export type RepoKind = 'model' | 'script';

/** A git-managed repository living as a sub-folder of a mounted volume. */
export interface RepoInfo {
  id: string;
  kind: RepoKind;
  path: string;
  /** Remote URL with any embedded credentials stripped. */
  url: string | null;
  branch: string | null;
  commit: string | null;
  subject: string | null;
  /** Committer date, ISO 8601. */
  date: string | null;
  /** Working tree has uncommitted changes. */
  dirty: boolean;
}

export interface RepoAddRequest {
  url: string;
  id?: string;
  branch?: string;
  /** Overrides the username embedded in `url`. Defaults to `oauth2` when only a token is given. */
  username?: string;
  /** Access token used as the password. */
  token?: string;
}

export interface RepoSyncRequest {
  username?: string;
  token?: string;
}

export type ResultEncoding = 'json' | 'utf8' | 'base64';

export interface ResultPayload {
  /** Absolute path of the file the script referenced. */
  file: string;
  encoding: ResultEncoding;
  /** Parsed JSON, text, or base64 string depending on `encoding`. */
  content: unknown;
  size: number;
  truncated: boolean;
}

export interface RunResponse {
  correlationId: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  result: ResultPayload | null;
}

/** Internal result; `timedOut` drives the HTTP status and is not serialized. */
export interface RunResult extends RunResponse {
  timedOut: boolean;
}
