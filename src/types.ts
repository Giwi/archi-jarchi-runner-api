/**
 * Request body for executing a jArchi script.
 */
export interface RunRequestBody {
  /** Unique identifier for correlating logs and responses. */
  correlationId: string;
  /** jArchi script source code to execute. */
  script: string;
  /** Path to model inside the models volume. Can be a directory (coArchi repo) or .archimate file. */
  model: string;
}

/**
 * Parameters for a server-driven jArchi run (script supplied by the server).
 */
export interface RunScriptRequest {
  /** Unique identifier for correlating logs and responses. */
  correlationId: string;
  /** Path to model inside the models volume. */
  model: string;
  /** jArchi script source code to execute. */
  script: string;
  /** Options exposed to the script as `archiServer.options`. */
  options?: Record<string, unknown>;
}

/** Mermaid flowchart direction. */
export type MermaidDirection = 'LR' | 'RL' | 'TB' | 'BT';

/**
 * Request for exporting ArchiMate views as Mermaid.
 */
export interface MermaidExportRequest {
  /** Unique identifier for correlating logs and responses. */
  correlationId: string;
  /** Path to model inside the models volume. */
  model: string;
  /** View id (`#id`) or exact view name. Mutually exclusive with `folder`. */
  view?: string;
  /** Model folder name or slash-separated folder path. Mutually exclusive with `view`. */
  folder?: string;
  /** Mermaid flowchart direction. Defaults to 'LR'. */
  direction?: MermaidDirection;
  /** Include relationships as edges. Defaults to true. */
  relationships?: boolean;
}

/**
 * Response for Mermaid export including markdown.
 */
export interface MermaidExportResponse extends RunResponse {
  /** Generated markdown with Mermaid flowcharts (convenience copy of `result.content.markdown`). */
  markdown: string | null;
}

/** Type of git-managed repository. */
export type RepoKind = 'model' | 'script';

/**
 * Metadata for a git-managed repository living as a sub-folder of a mounted volume.
 */
export interface RepoInfo {
  /** Repository identifier (folder name). */
  id: string;
  /** Type of repository. */
  kind: RepoKind;
  /** Absolute path to repository on filesystem. */
  path: string;
  /** Remote URL with any embedded credentials stripped. */
  url: string | null;
  /** Current branch name. */
  branch: string | null;
  /** Current commit hash. */
  commit: string | null;
  /** Commit subject. */
  subject: string | null;
  /** Commit date in ISO 8601 format. */
  date: string | null;
  /** Working tree has uncommitted changes. */
  dirty: boolean;
}

/**
 * Request to add a git-managed repository.
 */
export interface RepoAddRequest {
  /** Git repository URL (http(s) only). */
  url: string;
  /** Custom repository ID. Derived from URL if not provided. */
  id?: string;
  /** Branch to clone. Defaults to remote HEAD. */
  branch?: string;
  /** Username override. Defaults to 'oauth2' when only token is provided. */
  username?: string;
  /** Access token for authentication. */
  token?: string;
}

/**
 * Request to sync a git-managed repository.
 */
export interface RepoSyncRequest {
  /** Username for authentication rotation. */
  username?: string;
  /** Token for authentication rotation. */
  token?: string;
}

/** Encoding type for result file content. */
export type ResultEncoding = 'json' | 'utf8' | 'base64';

/**
 * Result payload returned from a script run.
 */
export interface ResultPayload {
  /** Absolute path of the file the script referenced. */
  file: string;
  /** Encoding of the content. */
  encoding: ResultEncoding;
  /** Parsed JSON, text, or base64 string depending on `encoding`. */
  content: unknown;
  /** Size of the file in bytes. */
  size: number;
  /** Whether the content was truncated due to size limits. */
  truncated: boolean;
}

/**
 * Standard response for a script run.
 */
export interface RunResponse {
  /** Unique identifier for correlating logs and responses. */
  correlationId: string;
  /** Standard output from Archi. */
  stdout: string;
  /** Standard error from Archi. */
  stderr: string;
  /** Exit code from Archi process. */
  exitCode: number | null;
  /** Result payload from script if advertised. */
  result: ResultPayload | null;
}

/**
 * Internal result with timeout flag; `timedOut` drives HTTP status and is not serialized.
 */
export interface RunResult extends RunResponse {
  /** Whether the run timed out and was killed. */
  timedOut: boolean;
}
