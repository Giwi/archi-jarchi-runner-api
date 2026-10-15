/**
 * Hand-written OpenAPI 3.0 document served at `/openapi.json`.
 */
export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'archi-server',
    version: '0.1.0',
    description:
      'Runs Archi (headless) with jArchi + coArchi and manages git-backed model ' +
      'and script repositories.\n\n' +
      'When `API_KEY` is set, every `/api/*` request must send the `x-api-key` header.',
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'Run', description: 'Execute jArchi scripts against a model.' },
    { name: 'Export', description: 'Generate documentation (Markdown + Mermaid) from views.' },
    { name: 'Models', description: 'Git-managed model repositories under /models.' },
    { name: 'Scripts', description: 'Git-managed script repositories under /scripts.' },
    { name: 'System', description: 'Health and metadata.' },
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
    },
    parameters: {
      RepoId: {
        name: 'id',
        in: 'path',
        required: true,
        description: 'Repository id (its folder name).',
        schema: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' },
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          details: { description: 'Optional context, e.g. git stderr.' },
        },
        required: ['error'],
      },
      RunRequest: {
        type: 'object',
        properties: {
          correlationId: { type: 'string', minLength: 1, example: 'demo-1' },
          script: { type: 'string', minLength: 1, description: 'jArchi source.' },
          model: {
            type: 'string',
            minLength: 1,
            description:
              'Path inside /models. A directory loads as a coArchi repository; ' +
              'a file loads with --loadModel.',
            example: 'my-model',
          },
        },
        required: ['correlationId', 'script', 'model'],
      },
      ResultPayload: {
        type: 'object',
        nullable: true,
        properties: {
          file: { type: 'string' },
          encoding: { type: 'string', enum: ['json', 'utf8', 'base64'] },
          content: { description: 'Parsed JSON, text, or base64 string.' },
          size: { type: 'integer' },
          truncated: { type: 'boolean' },
        },
        required: ['file', 'encoding', 'content', 'size', 'truncated'],
      },
      RunResponse: {
        type: 'object',
        properties: {
          correlationId: { type: 'string' },
          stdout: { type: 'string' },
          stderr: { type: 'string' },
          exitCode: { type: 'integer', nullable: true },
          result: { $ref: '#/components/schemas/ResultPayload' },
        },
        required: ['correlationId', 'stdout', 'stderr', 'exitCode', 'result'],
      },
      MermaidExportRequest: {
        type: 'object',
        properties: {
          correlationId: { type: 'string', minLength: 1, example: 'export-1' },
          model: {
            type: 'string',
            minLength: 1,
            description: 'Path inside /models (repository folder or .archimate file).',
          },
          view: {
            type: 'string',
            description: 'View id (#id) or exact view name. Mutually exclusive with `folder`.',
          },
          folder: {
            type: 'string',
            description:
              'Model folder name or slash-separated folder path; every view under it is exported. ' +
              'Mutually exclusive with `view`. Omit both to export the whole model.',
          },
          direction: { type: 'string', enum: ['LR', 'RL', 'TB', 'BT'], default: 'LR' },
          relationships: { type: 'boolean', default: true, description: 'Include relationships as edges.' },
        },
        required: ['correlationId', 'model'],
      },
      MermaidExportResponse: {
        allOf: [
          { $ref: '#/components/schemas/RunResponse' },
          {
            type: 'object',
            properties: {
              markdown: {
                type: 'string',
                nullable: true,
                description: 'Generated Markdown with one Mermaid `flowchart` per view.',
              },
            },
            required: ['markdown'],
          },
        ],
      },
      Repo: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: ['model', 'script'] },
          path: { type: 'string' },
          url: { type: 'string', nullable: true, description: 'Remote URL without credentials.' },
          branch: { type: 'string', nullable: true },
          commit: { type: 'string', nullable: true },
          subject: { type: 'string', nullable: true },
          date: { type: 'string', nullable: true, format: 'date-time' },
          dirty: { type: 'boolean' },
        },
        required: ['id', 'kind', 'path', 'dirty'],
      },
      RepoAddRequest: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            minLength: 1,
            description:
              'HTTP(S) git URL. A token may be embedded ' +
              '(https://oauth2:TOKEN@host/org/repo.git). SSH is not supported.',
            example: 'https://git.example.com/org/my-model.git',
          },
          id: {
            type: 'string',
            pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
            description: "Folder name; derived from the URL's last segment when omitted.",
          },
          branch: { type: 'string', description: 'Defaults to the remote HEAD.' },
          username: { type: 'string', description: 'Defaults to `oauth2` when only a token is given.' },
          token: { type: 'string', description: 'Access token used as the password.' },
        },
        required: ['url'],
      },
      RepoSyncRequest: {
        type: 'object',
        properties: {
          username: { type: 'string', description: 'Rotates the stored username.' },
          token: { type: 'string', description: 'Rotates the stored token.' },
        },
      },
      RepoSyncResult: {
        allOf: [
          { $ref: '#/components/schemas/Repo' },
          {
            type: 'object',
            properties: {
              updated: { type: 'boolean' },
              previousCommit: { type: 'string', nullable: true },
            },
            required: ['updated', 'previousCommit'],
          },
        ],
      },
      ModelList: {
        type: 'object',
        properties: { models: { type: 'array', items: { $ref: '#/components/schemas/Repo' } } },
        required: ['models'],
      },
      ScriptList: {
        type: 'object',
        properties: { scripts: { type: 'array', items: { $ref: '#/components/schemas/Repo' } } },
        required: ['scripts'],
      },
    },
  },
  security: [{ ApiKeyAuth: [] }, {}],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Liveness probe',
        responses: { '200': { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' } } } } } } },
      },
    },
    '/api/run': {
      post: {
        tags: ['Run'],
        summary: 'Run a jArchi script against a model',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RunRequest' } } },
        },
        responses: {
          '200': { description: 'Run finished', content: { 'application/json': { schema: { $ref: '#/components/schemas/RunResponse' } } } },
          '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '401': { description: 'Missing or invalid x-api-key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '404': { description: 'Model not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '504': { description: 'Run timed out', content: { 'application/json': { schema: { $ref: '#/components/schemas/RunResponse' } } } },
        },
      },
    },
    '/api/export/mermaid': {
      post: {
        tags: ['Export'],
        summary: 'Export ArchiMate view(s) as Markdown with Mermaid flowcharts',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/MermaidExportRequest' } } },
        },
        responses: {
          '200': { description: 'Generated', content: { 'application/json': { schema: { $ref: '#/components/schemas/MermaidExportResponse' } } } },
          '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '404': { description: 'Model not found, or no views matched', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '504': { description: 'Run timed out', content: { 'application/json': { schema: { $ref: '#/components/schemas/MermaidExportResponse' } } } },
        },
      },
    },
    '/api/models': {
      get: {
        tags: ['Models'],
        summary: 'List model repositories',
        responses: { '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/ModelList' } } } } },
      },
      post: {
        tags: ['Models'],
        summary: 'Clone a model repository',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RepoAddRequest' } } },
        },
        responses: {
          '201': { description: 'Cloned', content: { 'application/json': { schema: { $ref: '#/components/schemas/Repo' } } } },
          '400': { description: 'Invalid body or URL', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'Id already exists', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '502': { description: 'git clone failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '504': { description: 'git timed out', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/models/{id}/sync': {
      post: {
        tags: ['Models'],
        summary: 'Sync a model repository (fetch + fast-forward)',
        parameters: [{ $ref: '#/components/parameters/RepoId' }],
        requestBody: { required: false, content: { 'application/json': { schema: { $ref: '#/components/schemas/RepoSyncRequest' } } } },
        responses: {
          '200': { description: 'Synced', content: { 'application/json': { schema: { $ref: '#/components/schemas/RepoSyncResult' } } } },
          '404': { description: 'Unknown repository', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'Not a git repo or detached HEAD', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '502': { description: 'git failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/models/{id}': {
      delete: {
        tags: ['Models'],
        summary: 'Remove a model repository',
        parameters: [{ $ref: '#/components/parameters/RepoId' }],
        responses: {
          '204': { description: 'Removed' },
          '404': { description: 'Unknown repository', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'Not a git repo', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/scripts': {
      get: {
        tags: ['Scripts'],
        summary: 'List script repositories',
        responses: { '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/ScriptList' } } } } },
      },
      post: {
        tags: ['Scripts'],
        summary: 'Clone a script repository',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RepoAddRequest' } } },
        },
        responses: {
          '201': { description: 'Cloned', content: { 'application/json': { schema: { $ref: '#/components/schemas/Repo' } } } },
          '400': { description: 'Invalid body or URL', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'Id already exists', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '502': { description: 'git clone failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '504': { description: 'git timed out', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/scripts/{id}/sync': {
      post: {
        tags: ['Scripts'],
        summary: 'Sync a script repository (fetch + fast-forward)',
        parameters: [{ $ref: '#/components/parameters/RepoId' }],
        requestBody: { required: false, content: { 'application/json': { schema: { $ref: '#/components/schemas/RepoSyncRequest' } } } },
        responses: {
          '200': { description: 'Synced', content: { 'application/json': { schema: { $ref: '#/components/schemas/RepoSyncResult' } } } },
          '404': { description: 'Unknown repository', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'Not a git repo or detached HEAD', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '502': { description: 'git failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/scripts/{id}': {
      delete: {
        tags: ['Scripts'],
        summary: 'Remove a script repository',
        parameters: [{ $ref: '#/components/parameters/RepoId' }],
        responses: {
          '204': { description: 'Removed' },
          '404': { description: 'Unknown repository', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'Not a git repo', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
  },
} as const;
