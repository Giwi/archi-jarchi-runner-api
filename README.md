# archi-server

HTTP service that runs [Archi](https://www.archimatetool.com) in **headless** mode
(ACLI) with the **jArchi** scripting and **coArchi** model-collaboration plugins,
and returns the script output. It also manages git-backed model and script
repositories inside the mounted volumes.

- **Runtime**: Node.js 22 + TypeScript, Archi 5.6 with its bundled Temurin JRE 21.
- **Plugins**: jArchi `1.11.0`, coArchi `0.9.7`.
- **Volumes**: `/scripts` (jArchi user scripts) and `/models` (coArchi repos / `.archimate` files).
- **Repositories**: git-managed sub-folders of those volumes, cloned/synced over **HTTPS** with an access token.

> Documentation site: `docs/index.html`, published to GitHub Pages by `.github/workflows/pages.yml`.
> Source: <https://github.com/Giwi/archi-jarchi-runner-api> &middot; License: GPL-3.0-or-later.

```mermaid
flowchart LR
  client([API client]) -->|POST /api/run| server[archi-server]
  client -->|git repo CRUD| server
  server -->|write script + spawn| archi["Archi ACLI<br/>jArchi + coArchi"]
  archi -->|"stdout + resultFile"| server
  server -->|JSON| client

  subgraph volumes [Mounted volumes]
    scripts["/scripts<br/>script repos (git)"]
    models["/models<br/>model repos (git) + *.archimate"]
  end
  server -.->|clone / fetch / pull| scripts
  server -.->|clone / fetch / pull| models
```

## Why these versions?

| Component | Version | Requirement | Reason |
|-----------|---------|-------------|--------|
| Archi     | 5.6.0   | JRE 21      | Requested base. |
| jArchi    | **1.11.0** | Archi >= 5.5.0 | jArchi **1.12 requires Archi >= 5.8**, so it cannot run on 5.6. 1.11.0 ships the same GraalVM 24.1.2 JS engine. |
| coArchi   | 0.9.7   | Archi >= 4.9.0 | Latest 0.9.x, compatible with 5.6. |

> If jArchi 1.12 is mandatory, move the base to Archi 5.8+ (coArchi 0.9.7 still fits).

## 1. Fetch the binaries

Binaries live under `vendor/` (git-ignored) and are copied into the image.

```bash
scripts/fetch-archi.sh
```

This downloads Archi 5.6 and coArchi 0.9.7. jArchi's compiled binary is not
publicly downloadable, so either:

1. drop the provided `jarchi*.archiplugin` into `vendor/plugins/`,
2. run with `JARCHI_URL=<url> scripts/fetch-archi.sh`, or
3. build it from source (see below).

### Build jArchi from source (optional)

Compiles jArchi `v1.11.0` with Maven/Tycho against the local Archi install
(requires `git`, `mvn`, network):

```bash
scripts/build-plugins.sh
```

Resulting bundles land in `vendor/plugins/com.archimatetool.script*.jar`. The
build uses the committed Maven wrapper (`./mvnw`), which pins a Tycho-compatible
Maven 3.9.x, so no local Maven is required.

## 2. Build and run

```bash
docker compose up --build
# or
docker build -t archi-server .
docker run --rm -p 3000:3000 \
  -v "$PWD/data/scripts:/scripts" \
  -v "$PWD/data/models:/models" \
  -e ARCHI_XMS=512m -e ARCHI_XMX=4g \
  archi-server
```

The container runs as uid `1001`. If your host user differs, build with a
matching uid so repositories can be cloned into the mounted volumes:

```bash
docker build --build-arg ARCHI_UID="$(id -u)" -t archi-server .
# compose: ARCHI_UID="$(id -u)" docker compose up --build
```

## 3. API

### `POST /api/run`

Request body:

```json
{
  "correlationId": "string",
  "script": "jArchi script source",
  "model": "path/name inside the /models volume"
}
```

- `model` is resolved **inside `/models`** (path traversal is rejected).
  - a **directory** is loaded as a coArchi repository: `--modelrepository.loadModel`.
    The directory must already be a coArchi/GRAFICO repository (i.e. contain a
    `model/folder.xml`); otherwise coArchi reports an error in `stderr`.
  - a **file** (`.archimate`) is loaded with `--loadModel`.
- `script` is the jArchi source, executed with `--script.runScript`.

Response (`200`), or `504` on timeout (same shape):

```json
{
  "correlationId": "string",
  "stdout": "...",
  "stderr": "...",
  "exitCode": 0,
  "result": {
    "file": "/var/archi/runs/run-xxxx/result.json",
    "encoding": "json",
    "content": { "any": "parsed JSON, or text, or base64" },
    "size": 42,
    "truncated": false
  }
}
```

`result` is `null` when the script does not advertise a result file.

Example:

```bash
curl -s http://localhost:3000/api/run \
  -H 'content-type: application/json' \
  -d @samples/request.json | jq
```

### `GET /health`

`{"status":"ok"}`.

### `GET /openapi.json`

OpenAPI 3.0 document describing every endpoint. Point any Swagger UI or client
generator at it (no UI is bundled).

### Result files

A script advertises a result file by printing a JSON object with a
`resultFile` (or `result_file` / `result`) string. Relative paths resolve
against the run directory.

Every script gets a prelude with a helper and context:

```javascript
archiServer = {
  correlationId: "...",
  runDir: "/var/archi/runs/run-xxxx",
  resultFile: "/var/archi/runs/run-xxxx/result.json",
  setResult: function (value) { /* writes result.json and prints {resultFile} */ }
};
```

```javascript
// script.ajs
console.log("model=" + model.name);
archiServer.setResult({ elementCount: $(".archimate-element").size() });
```

Plain `console.log` output is returned in `stdout` (headless jArchi falls back
to `System.out`).

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant S as archi-server
  participant A as Archi ACLI
  C->>S: POST /api/run {correlationId, script, model}
  S->>S: validate + acquire semaphore
  S->>S: write script.ajs (+ prelude) in run dir
  S->>A: Archi --loadModel/--modelrepository.loadModel --script.runScript
  A-->>S: stdout, stderr, exit code
  A->>S: resultFile (JSON path printed on stdout)
  S->>S: read + decode result file
  S-->>C: 200 {correlationId, stdout, stderr, exitCode, result}
```

### `POST /api/export/mermaid`

Generate Markdown with one Mermaid `flowchart` per ArchiMate view. The server
runs a bundled jArchi script that walks the view(s) and returns the Markdown.

```json
{
  "correlationId": "export-1",
  "model": "my-model",
  "view": "Customer Journey",
  "direction": "LR",
  "relationships": true
}
```

- `model` resolved inside `/models` (a repository folder or a `.archimate` file).
- `view` *(optional)*: a view id (`#id`) or its exact name.
- `folder` *(optional)*: a model folder name, or a `Parent/Child` path; every
  view under it is exported. Mutually exclusive with `view`.
- Omit both `view` and `folder` to export **all** views.
- `direction`: `LR` (default), `RL`, `TB` or `BT`.
- `relationships`: include relationships as edges (default `true`).

The response is the standard `/api/run` envelope plus `markdown`:

```json
{
  "correlationId": "export-1",
  "exitCode": 0,
  "markdown": "# ArchiMate views\n\n## Customer Journey\n\n```mermaid\nflowchart LR\n  n1[\"Customer<br/>(business actor)\"]\n  n2[\"Agent<br/>(business role)\"]\n  n1 -->|\"assigned to\"| n2\n```",
  "result": { "file": "...", "encoding": "json", "content": { "markdown": "...", "views": [ ... ], "count": 1 } }
}
```

`result.content.views` summarises each exported view (`id`, `name`, `type`,
`nodes`, `edges`). Returns `404` when the model is missing **or** when no view
matches `view`/`folder`.

### Model repositories

Models are **git-managed sub-folders of `/models`**. Each is identified by an
`id` (its folder name); `POST /api/run` loads it by that same id. Plain
`.archimate` files placed directly in `/models` still work with `POST /api/run`
but are not listed here.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/models` | List managed model repositories. |
| `POST` | `/api/models` | Clone a new repository. |
| `POST` | `/api/models/:id/sync` | Fetch + fast-forward to the remote. |
| `DELETE` | `/api/models/:id` | Remove a repository. |

### Script repositories

Script repositories are git-managed sub-folders of `/scripts`. Add them to share
jArchi libraries (`require`) or reusable scripts.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/scripts` | List managed script repositories. |
| `POST` | `/api/scripts` | Clone a new repository. |
| `POST` | `/api/scripts/:id/sync` | Fetch + fast-forward to the remote. |
| `DELETE` | `/api/scripts/:id` | Remove a repository. |

### Add a repository

`POST /api/models` (and `POST /api/scripts`) accept:

```json
{
  "url": "https://git.example.com/org/my-model.git",
  "id": "my-model",
  "branch": "main",
  "username": "oauth2",
  "token": "glpat-xxxxxxxx"
}
```

- `url` **required**, must be `http://` or `https://` (SSH is not supported).
  A token may be embedded: `https://oauth2:TOKEN@host/org/repo.git`.
- `id` optional, derived from the URL's last segment (`repo.git` -> `repo`).
  Must match `[A-Za-z0-9][A-Za-z0-9._-]*`, no path separators.
- `branch` optional; defaults to the remote HEAD.
- `username` optional; defaults to `oauth2` when only a `token` is given
  (accepted by GitHub and GitLab).
- `token` optional; sent as the password.

Returns `201` with the repository object, or `409` when the id already exists:

```json
{
  "id": "my-model",
  "kind": "model",
  "path": "/models/my-model",
  "url": "https://git.example.com/org/my-model.git",
  "branch": "main",
  "commit": "7fd1a60b01f9…",
  "subject": "Merge pull request #6",
  "date": "2012-03-06T15:06:50-08:00",
  "dirty": false
}
```

### Sync a repository

`POST /api/models/:id/sync` runs `git fetch --prune` followed by a
fast-forward-only merge. It returns the refreshed object plus:

```json
{ "updated": true, "previousCommit": "1a2b3c…" }
```

The stored token is reused; pass `{ "username": "...", "token": "..." }` to
rotate it. Non-fast-forward local commits are refused (the merge only advances).

### Remove a repository

`DELETE /api/models/:id` deletes the folder. Returns `204`.

### Credentials

- Tokens are **never** written into `.git/config`: the remote URL is stored
  sanitized and the token is kept in `<repo>/.git/archi-server-credentials.json`
  (mode `0600`) so `sync` can authenticate non-interactively.
- git is invoked through an askpass helper, so the token never appears in the
  process arguments. Set `ARCHI_GIT_ASKPASS` to relocate that helper.

### Repository errors

| Status | When |
|--------|------|
| `400` | Invalid body, non-http(s) URL, bad id/branch. |
| `404` | Unknown repository id. |
| `409` | Id exists, folder is not a git repo, or detached HEAD. |
| `502` | git failed (includes `stderr` in `details`). |
| `504` | git operation exceeded `ARCHI_GIT_TIMEOUT_MS`. |

## Configuration (environment variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `ARCHI_HOME` | `/opt/archi` | Archi install root. |
| `ARCHI_BINARY` | `$ARCHI_HOME/Archi` | Launcher path. |
| `ARCHI_SCRIPTS_DIR` | `/scripts` | jArchi user scripts volume. |
| `ARCHI_MODELS_DIR` | `/models` | Model volume. |
| `ARCHI_RUNS_DIR` | `/var/archi/runs` | Per-run scratch dir. |
| `GIT_BINARY` | `git` | git executable used for repository management. |
| `ARCHI_GIT_TIMEOUT_MS` | `300000` | Timeout for a single git operation. |
| `ARCHI_GIT_ASKPASS` | `/usr/local/bin/git-askpass.sh` | Helper that feeds the access token to git. |
| `ARCHI_XMS` | `256m` | JVM initial heap (written to `Archi.ini`). |
| `ARCHI_XMX` | `2g` | JVM max heap (written to `Archi.ini`). |
| `ARCHI_TIMEOUT_MS` | `120000` | Kill a run after this long. |
| `ARCHI_MAX_CONCURRENCY` | `1` | Parallel Archi runs (each = JVM + display). |
| `ARCHI_RESULT_MAX_BYTES` | `26214400` | Max result file returned. |
| `ARCHI_KEEP_RUN_DIRS` | `false` | Keep per-run dirs for debugging. |
| `API_KEY` | *(unset)* | When set, require `x-api-key`. |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error`. |

## Development

```bash
npm ci
npm run typecheck   # tsc, checks src + test (tsconfig.test.json)
npm test            # node --test via tsx (no external test deps)
npm run test:ci     # same, plus test-results/junit.xml (JUnit XML)
npm run build       # emit dist/
```

Unit tests live in `test/` and use Node's built-in runner:

- `test/git.test.ts` - id validation plus full clone / list / sync / remove
  against a throwaway **local smart-HTTP git server** (backed by
  `git http-backend`), so no network is required.
- `test/server.test.ts` - the Express app via `fetch`: health, OpenAPI spec,
  auth, body validation and the repository routes.

CI (`.github/workflows/docker-publish.yml`) typechecks and runs the tests on
every push and pull request, **publishes the JUnit report as a check**
(`dorny/test-reporter`) and uploads it as an artifact, then builds the Docker
image. The image is **published to GHCR only for tag commits** (`v*`); other
runs build without pushing.

## Notes & limitations

- Each run starts a JVM; keep `ARCHI_MAX_CONCURRENCY` low.
- The image runs as non-root user `archi` (uid `1001` by default). The `/models`
  and `/scripts` mounts must be writable by that uid for clone/sync to work; set
  `--build-arg ARCHI_UID=$(id -u)` to match your host user, or `chown` the
  mounted directories.
- Repository auth is **HTTPS + access token only** (no SSH). Tokens are stored
  per-repository under `.git/` with mode `0600`.
- Archi emits `SLF4J(W): No SLF4J providers were found.` on `stderr`; harmless.
  Silence it with `JAVA_TOOL_OPTIONS=-Dslf4j.internal.verbosity=ERROR` if needed.

## License

Copyright (C) 2026 [giwi.fr](https://giwi.fr).

Released under the [GNU General Public License v3.0 or later](LICENSE) (GPL-3.0-or-later).
Source: <https://github.com/Giwi/archi-jarchi-runner-api>.
