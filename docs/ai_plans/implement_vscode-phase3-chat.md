# Implementation Plan: VS Code Extension — Phase 3: Interactive Exploration & Hybrid Execution (Chat)

**Date**: 2026-05-22  
**Status**: Ready for Implementation  
**Affected Package**: `@workspace/vscode-client` (`artifacts/vscode-client/`)

---

## 1. Implementation Goals

| # | Goal | Verifiable Success Criterion |
|---|------|------------------------------|
| G1 | Register `@docuvia` chat participant with slash commands | Opening VS Code Chat and typing `@docuvia /explore` shows Docuvia suggestions; no TypeScript compile errors in `tsc --noEmit` |
| G2 | Implement `/explore` L1 exploration mode | Running `/explore` in Chat reads workspace `README.md` + `package.json`, detects project type, outputs candidate YAML for `.docuvia/l1_tags.yaml`, and offers an "Accept" button via `stream.button()` |
| G3 | Interactive fallback for unrecognized projects | When detection confidence is low, `/explore` asks one clarifying question in the chat stream |
| G4 | `/query` searches local knowledge graph | Running `/query auth` returns matching L2 modules and L3 decisions from `KnowledgeStore.snapshot` as markdown; includes a Phase 5 stub comment for central server routing |
| G5 | `/extract` queues L3 extraction via `DocuviaTaskRunner` | Running `/extract` adds a task to `TaskQueueTreeProvider`; task transitions `pending → in_progress → done` and the Task Queue TreeView updates live |
| G6 | `docuvia.runExtraction` command registered | Command is invocable from Command Palette and programmatically from Chat |
| G7 | `DocuviaTaskRunner` chunks + processes via VS Code LM API | Content > 4000 chars is split; each chunk is processed sequentially (not in parallel) using `vscode.lm.selectChatModels()` |
| G8 | No external HTTP calls in Phase 3 | No `fetch`, no OpenAI SDK, no Ollama, no `http.request` — only `vscode.lm` APIs |
| G9 | `package.json` declares chat participant and all new commands | `contributes.chatParticipants` and `contributes.commands` entries pass schema validation |

---

## 2. Architecture & Approach

### 2.1 VS Code APIs Used (vscode ^1.90.0)

The `@types/vscode ^1.90.0` version includes the stable Chat Participant API:

```typescript
// Create participant
const participant = vscode.chat.createChatParticipant('docuvia', handler);

// Handler signature
type ChatRequestHandler = (
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
) => Promise<vscode.ChatResult | void>;

// Key fields on request
request.command      // 'explore' | 'query' | 'extract' | 'help' | undefined
request.prompt       // user's message text after the slash command

// Streaming response methods
stream.markdown(text: string | vscode.MarkdownString): void
stream.progress(text: string): void
stream.button(command: vscode.Command): void

// Language Model API
const models = await vscode.lm.selectChatModels({ family: 'gpt-4o' });
// model.sendRequest returns AsyncIterable<LanguageModelTextPart | ...>
const response = await model.sendRequest(messages, {}, token);
for await (const part of response.text) { ... }
```

### 2.2 New Files

| File | Responsibility |
|------|---------------|
| `artifacts/vscode-client/src/ChatParticipant.ts` | Registers the `@docuvia` participant, routes slash commands, implements L1 exploration and local query logic |
| `artifacts/vscode-client/src/TaskRunner.ts` | `DocuviaTaskRunner` class: chunking, sequential LM processing, task status management |

### 2.3 Modified Files

| File | Changes |
|------|---------|
| `artifacts/vscode-client/src/extension.ts` | Import + register `ChatParticipant` and `DocuviaTaskRunner`; register `docuvia.runExtraction` and `docuvia.clearCompletedTasks` commands |
| `artifacts/vscode-client/package.json` | Add `contributes.chatParticipants`, add two new command entries |

---

## 3. L1 Ontology Templates

Define these as a constant `L1_TEMPLATES` inside `ChatParticipant.ts`. Each template drives the `/explore` suggestion when a project type is detected.

```typescript
interface L1TemplateTag {
  slug: string;
  name: string;
  description: string;
}

interface L1Template {
  projectType: 'frontend' | 'backend' | 'fullstack' | 'monorepo' | 'library' | 'cli';
  label: string;
  /** Keywords searched in README.md text (lowercased) and package.json dependency names */
  keywords: string[];
  tags: L1TemplateTag[];
}

const L1_TEMPLATES: L1Template[] = [
  {
    projectType: 'frontend',
    label: 'Frontend Application',
    keywords: ['react', 'vue', 'angular', 'svelte', 'vite', 'next', 'nuxt', 'gatsby'],
    tags: [
      { slug: 'ui-components', name: 'UI Components', description: 'Reusable visual building blocks' },
      { slug: 'routing', name: 'Routing', description: 'Client-side navigation and route definitions' },
      { slug: 'state-management', name: 'State Management', description: 'Global and local state handling' },
      { slug: 'styling', name: 'Styling', description: 'CSS, theming, and design tokens' },
      { slug: 'api-integration', name: 'API Integration', description: 'Data fetching and API client configuration' },
    ],
  },
  {
    projectType: 'backend',
    label: 'Backend / API Server',
    keywords: ['express', 'fastify', 'hapi', 'koa', 'nestjs', 'django', 'flask', 'rails', 'spring'],
    tags: [
      { slug: 'api-routes', name: 'API Routes', description: 'HTTP endpoint definitions and middleware' },
      { slug: 'database', name: 'Database', description: 'Schema, ORM, and query patterns' },
      { slug: 'authentication', name: 'Authentication', description: 'Identity, sessions, and JWT handling' },
      { slug: 'services', name: 'Services', description: 'Business logic and domain services' },
      { slug: 'infrastructure', name: 'Infrastructure', description: 'Deployment, configuration, and environment' },
    ],
  },
  {
    projectType: 'fullstack',
    label: 'Fullstack Application',
    keywords: ['fullstack', 'full-stack', 'trpc', 'remix', 'sveltekit'],
    tags: [
      { slug: 'frontend', name: 'Frontend', description: 'Client-side UI layer' },
      { slug: 'backend', name: 'Backend', description: 'Server-side API and logic' },
      { slug: 'database', name: 'Database', description: 'Data persistence layer' },
      { slug: 'api-contract', name: 'API Contract', description: 'Shared types and OpenAPI/tRPC schema' },
      { slug: 'devops', name: 'DevOps', description: 'CI/CD, deployment, and infrastructure' },
    ],
  },
  {
    projectType: 'monorepo',
    label: 'Monorepo / Multi-package',
    keywords: ['monorepo', 'workspace', 'turborepo', 'nx', 'lerna', 'pnpm-workspace'],
    tags: [
      { slug: 'core', name: 'Core', description: 'Shared foundation utilities and types' },
      { slug: 'ui-layer', name: 'UI Layer', description: 'Frontend packages and design system' },
      { slug: 'api-layer', name: 'API Layer', description: 'Backend packages and services' },
      { slug: 'shared', name: 'Shared', description: 'Cross-cutting libraries used by multiple packages' },
      { slug: 'build-system', name: 'Build System', description: 'Tooling, bundlers, and pipeline configuration' },
    ],
  },
  {
    projectType: 'library',
    label: 'Library / SDK / Package',
    keywords: ['library', 'sdk', 'package', 'npm', 'publish'],
    tags: [
      { slug: 'core-api', name: 'Core API', description: 'Primary public surface area' },
      { slug: 'utilities', name: 'Utilities', description: 'Internal helpers and abstractions' },
      { slug: 'types', name: 'Types', description: 'TypeScript type definitions and schemas' },
      { slug: 'testing', name: 'Testing', description: 'Test utilities and mocking helpers' },
      { slug: 'documentation', name: 'Documentation', description: 'Docs, examples, and changelogs' },
    ],
  },
  {
    projectType: 'cli',
    label: 'CLI Tool',
    keywords: ['cli', 'command-line', 'commander', 'yargs', 'oclif', 'bin'],
    tags: [
      { slug: 'commands', name: 'Commands', description: 'Individual CLI commands and their arguments' },
      { slug: 'io', name: 'I/O', description: 'Input parsing, output formatting, and prompts' },
      { slug: 'configuration', name: 'Configuration', description: 'Config file resolution and environment handling' },
      { slug: 'core-logic', name: 'Core Logic', description: 'Domain operations invoked by commands' },
      { slug: 'distribution', name: 'Distribution', description: 'Packaging, publishing, and update mechanisms' },
    ],
  },
];
```

---

## 4. Detailed Implementation Steps

### Step 1 — Create `artifacts/vscode-client/src/ChatParticipant.ts`

**Purpose**: Houses all chat participant logic. Exported function `registerChatParticipant` returns a `vscode.ChatParticipant` disposable.

#### 4.1.1 File structure outline

```typescript
import * as path from 'path';
import * as vscode from 'vscode';
import { KnowledgeStore } from './KnowledgeStore.js';
import { TaskRunner } from './TaskRunner.js';

// --- L1 template definitions (see Section 3 above) ---
// const L1_TEMPLATES: L1Template[] = [ ... ];

// --- Main export ---
export function registerChatParticipant(
  context: vscode.ExtensionContext,
  store: KnowledgeStore,
  taskRunner: TaskRunner
): vscode.ChatParticipant { ... }
```

#### 4.1.2 Chat handler routing logic

```typescript
const handler: vscode.ChatRequestHandler = async (request, _context, stream, token) => {
  switch (request.command) {
    case 'explore':  return handleExplore(request, stream, token, store);
    case 'query':    return handleQuery(request, stream, token, store);
    case 'extract':  return handleExtract(request, stream, token, store, taskRunner);
    case 'help':
    default:         return handleHelp(stream);
  }
};
```

#### 4.1.3 `handleExplore` — L1 Exploration Mode

```typescript
async function handleExplore(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  store: KnowledgeStore
): Promise<void> {
  stream.progress('Reading workspace files...');

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    stream.markdown('No workspace folder is open.');
    return;
  }

  // 1. Read README.md (catch if absent)
  let readmeContent = '';
  try {
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.file(path.join(workspaceRoot, 'README.md'))
    );
    readmeContent = Buffer.from(bytes).toString('utf-8');
  } catch { /* file absent — continue */ }

  // 2. Read package.json (catch if absent)
  let pkgJson: Record<string, unknown> = {};
  try {
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.file(path.join(workspaceRoot, 'package.json'))
    );
    pkgJson = JSON.parse(Buffer.from(bytes).toString('utf-8'));
  } catch { /* file absent — continue */ }

  // 3. Detect project type via template scoring
  const detected = detectProjectType(readmeContent, pkgJson);

  if (detected) {
    stream.progress(`Detected project type: ${detected.label}`);
    // 4a. Use VS Code LM to refine tag descriptions based on README context
    const refinedYaml = await refineTagsWithLM(detected, readmeContent, token);
    stream.markdown(`**Detected:** ${detected.label}\n\nSuggested \`.docuvia/l1_tags.yaml\`:\n\n\`\`\`yaml\n${refinedYaml}\n\`\`\``);
    stream.button({
      command: 'docuvia.acceptL1Tags',
      title: 'Accept & Write to .docuvia/l1_tags.yaml',
      arguments: [refinedYaml],
    });
  } else {
    // 4b. Interactive fallback — ask one clarifying question
    stream.markdown(
      "I couldn't detect your project type automatically.\n\n" +
      "**What best describes your project?**\n" +
      "- `frontend` — React, Vue, Angular, etc.\n" +
      "- `backend` — Express, Django, Rails, etc.\n" +
      "- `fullstack` — Both frontend and backend\n" +
      "- `monorepo` — Multiple packages in one repo\n" +
      "- `library` — An SDK or npm package\n" +
      "- `cli` — A command-line tool\n\n" +
      "Reply with `/explore <type>` (e.g. `/explore backend`) to get tag suggestions."
    );
  }
}
```

**`detectProjectType` function**:

```typescript
function detectProjectType(
  readmeLower: string,
  pkgJson: Record<string, unknown>
): L1Template | null {
  // Collect all dependency keys from package.json
  const allDeps = new Set<string>([
    ...Object.keys((pkgJson.dependencies as object) ?? {}),
    ...Object.keys((pkgJson.devDependencies as object) ?? {}),
  ]);

  // Check for pnpm workspaces in filesystem (fast path: field in package.json)
  const hasWorkspaces =
    !!pkgJson.workspaces ||
    readmeLower.includes('monorepo') ||
    readmeLower.includes('pnpm-workspace');

  if (hasWorkspaces) {
    return L1_TEMPLATES.find(t => t.projectType === 'monorepo')!;
  }

  // Score each template
  const scores = L1_TEMPLATES.map(template => {
    let score = 0;
    for (const kw of template.keywords) {
      if (readmeLower.includes(kw)) score += 1;
      if (allDeps.has(kw)) score += 2; // dependency match is stronger signal
    }
    return { template, score };
  });

  const best = scores.sort((a, b) => b.score - a.score)[0];
  return best.score >= 2 ? best.template : null;
}
```

**`refineTagsWithLM` function** (uses VS Code LM API):

```typescript
async function refineTagsWithLM(
  template: L1Template,
  readmeContent: string,
  token: vscode.CancellationToken
): Promise<string> {
  // Build a truncated readme excerpt (max 1500 chars to keep the prompt small)
  const readmeExcerpt = readmeContent.slice(0, 1500);

  // Attempt to select a model; fall back to raw YAML if none available
  const models = await vscode.lm.selectChatModels({ family: 'gpt-4o' });
  if (models.length === 0) {
    // Graceful degradation: return raw template YAML
    return buildRawYaml(template);
  }

  const model = models[0];
  const messages = [
    vscode.LanguageModelChatMessage.User(
      `You are a software architect. Given the README excerpt below and a list of standard L1 knowledge tags for a "${template.label}" project, ` +
      `customize the tag descriptions to match this specific project's domain language. ` +
      `Output ONLY valid YAML — a list of objects with fields: id (generate a UUID v4), slug, name, description. ` +
      `Do not add extra keys. Do not add explanatory text outside the YAML block.\n\n` +
      `README excerpt:\n${readmeExcerpt}\n\n` +
      `Template tags:\n${JSON.stringify(template.tags, null, 2)}`
    ),
  ];

  try {
    const response = await model.sendRequest(messages, {}, token);
    let yaml = '';
    for await (const part of response.text) {
      yaml += part;
    }
    // Strip any markdown code fences the model may add
    return yaml.replace(/^```ya?ml\n?/i, '').replace(/\n?```$/, '').trim();
  } catch {
    return buildRawYaml(template);
  }
}

function buildRawYaml(template: L1Template): string {
  const { v4: uuidv4 } = require('uuid');
  return template.tags
    .map(tag => [
      `- id: "${uuidv4()}"`,
      `  slug: "${tag.slug}"`,
      `  name: "${tag.name}"`,
      `  description: "${tag.description}"`,
    ].join('\n'))
    .join('\n');
}
```

#### 4.1.4 `handleQuery` — Local Knowledge Graph Search (+ Phase 5 Stub)

```typescript
async function handleQuery(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  _token: vscode.CancellationToken,
  store: KnowledgeStore
): Promise<void> {
  const query = request.prompt.trim().toLowerCase();
  if (!query) {
    stream.markdown('Usage: `/query <search term>` — searches your local `.docuvia` knowledge graph.');
    return;
  }

  const snapshot = store.snapshot;
  if (!snapshot) {
    stream.markdown('No `.docuvia/` folder loaded. Run **Docuvia: Init Project** first.');
    return;
  }

  // TODO Phase 5: If GlobalConfig.server_url is set and query intent is "breadth"
  // (cross-project), route to the central Docuvia API instead of local lookup.
  // Stub: const isBreadthQuery = await classifyQueryIntent(query, token);
  // if (isBreadthQuery && config.server_url) { return handleBreadthQuery(...); }

  // Local search: match modules and decisions against query terms
  const matchingModules = snapshot.modules.filter(m =>
    m.name.toLowerCase().includes(query) ||
    m.slug.includes(query) ||
    (m.description ?? '').toLowerCase().includes(query)
  );

  const matchingDecisions = [...snapshot.decisions.values()].filter(d =>
    d.title.toLowerCase().includes(query) ||
    d.body.toLowerCase().includes(query)
  );

  if (matchingModules.length === 0 && matchingDecisions.length === 0) {
    stream.markdown(`No local results found for **"${query}"**.\n\n_Tip: Phase 5 will add cross-project search via the central server._`);
    return;
  }

  if (matchingModules.length > 0) {
    stream.markdown(`### Matching L2 Modules\n` +
      matchingModules.map(m => `- **${m.name}** (\`${m.slug}\`) — ${m.description ?? ''}`).join('\n')
    );
  }

  if (matchingDecisions.length > 0) {
    stream.markdown(`### Matching L3 Decisions\n` +
      matchingDecisions.slice(0, 5).map(d =>
        `- **${d.title}** [${d.status}] — \`${d.filePath}\``
      ).join('\n')
    );
  }
}
```

#### 4.1.5 `handleExtract` — Queue Extraction Task

```typescript
async function handleExtract(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  store: KnowledgeStore,
  taskRunner: TaskRunner
): Promise<void> {
  // The user may provide a file path hint in the prompt, or we use the active editor
  const activeEditor = vscode.window.activeTextEditor;
  const filePath = request.prompt.trim() || activeEditor?.document.uri.fsPath;

  if (!filePath) {
    stream.markdown('Usage: `/extract [file-path]` — queue L3 decision extraction for a file. Open a file first or provide a path.');
    return;
  }

  let content: string;
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    content = Buffer.from(bytes).toString('utf-8');
  } catch {
    stream.markdown(`Could not read file: \`${filePath}\``);
    return;
  }

  stream.progress(`Queuing extraction for ${path.basename(filePath)}...`);
  const taskId = await taskRunner.queueExtraction({
    label: `L3 extract: ${path.basename(filePath)}`,
    content,
    sourceFilePath: filePath,
    token,
  });

  stream.markdown(
    `Extraction task **${taskId}** queued for \`${path.basename(filePath)}\`.\n\n` +
    `Check the **Task Queue** panel in the Docuvia sidebar to monitor progress.`
  );
}
```

#### 4.1.6 `handleHelp`

```typescript
function handleHelp(stream: vscode.ChatResponseStream): void {
  stream.markdown(
    `## @docuvia — Help\n\n` +
    `| Command | Description |\n` +
    `|---------|-------------|\n` +
    `| \`/explore\` | Detect project type and suggest L1 tags for \`.docuvia/l1_tags.yaml\` |\n` +
    `| \`/query <term>\` | Search your local knowledge graph for matching modules and decisions |\n` +
    `| \`/extract [path]\` | Queue L3 decision extraction for the active or specified file |\n` +
    `| \`/help\` | Show this help message |\n\n` +
    `_Breadth queries across projects will be available in Phase 5._`
  );
}
```

#### 4.1.7 `docuvia.acceptL1Tags` command

This command must also be registered in `extension.ts` (not just in package.json) since it is invoked programmatically via `stream.button()`:

```typescript
// In extension.ts
context.subscriptions.push(
  vscode.commands.registerCommand('docuvia.acceptL1Tags', async (yamlContent: string) => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;
    const uri = vscode.Uri.file(path.join(workspaceRoot, '.docuvia', 'l1_tags.yaml'));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(yamlContent, 'utf-8'));
    void vscode.window.showInformationMessage('Docuvia: l1_tags.yaml updated.');
  })
);
```

---

### Step 2 — Create `artifacts/vscode-client/src/TaskRunner.ts`

**Purpose**: `DocuviaTaskRunner` (also exported as `TaskRunner`) handles chunked, sequential LM-based L3 extraction and wires results back to `TaskQueueTreeProvider`.

#### 4.2.1 Interface definitions

```typescript
import * as path from 'path';
import * as vscode from 'vscode';
import { TaskQueueTreeProvider, ExtractionTask, TaskType } from './TaskQueueTreeProvider.js';

export interface ExtractionParams {
  label: string;
  content: string;
  sourceFilePath: string;
  token: vscode.CancellationToken;
  type?: TaskType;
}

const CHUNK_SIZE = 4000; // characters
const LM_FAMILY = 'gpt-4o';

export class TaskRunner {
  constructor(
    private readonly tqProvider: TaskQueueTreeProvider,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  /**
   * Splits content into chunks and processes each one sequentially using the
   * VS Code Language Model API. Updates TaskQueueTreeProvider throughout.
   * Returns the task ID.
   */
  async queueExtraction(params: ExtractionParams): Promise<string> {
    const { v4: uuidv4 } = await import('uuid');
    const taskId = uuidv4();

    const task: ExtractionTask = {
      id: taskId,
      label: params.label,
      type: params.type ?? 'l3_extraction',
      status: 'pending',
      createdAt: new Date(),
    };

    this.tqProvider.addTask(task);

    // Run asynchronously — do not await here so chat response returns immediately
    void this.runExtractionAsync(taskId, params);

    return taskId;
  }

  private async runExtractionAsync(
    taskId: string,
    params: ExtractionParams
  ): Promise<void> {
    this.tqProvider.updateTaskStatus(taskId, 'in_progress', 'Selecting LM...');

    // 1. Select model — fail gracefully if none available
    const models = await vscode.lm.selectChatModels({ family: LM_FAMILY });
    if (models.length === 0) {
      this.tqProvider.updateTaskStatus(taskId, 'failed', 'No LM model available');
      this.outputChannel.appendLine(`[Docuvia/TaskRunner] No LM models available for task ${taskId}`);
      return;
    }

    const model = models[0];
    const chunks = this.chunkContent(params.content);

    const allDecisions: string[] = [];
    let chunkIndex = 0;

    for (const chunk of chunks) {
      if (params.token.isCancellationRequested) {
        this.tqProvider.updateTaskStatus(taskId, 'failed', 'Cancelled');
        return;
      }

      chunkIndex++;
      this.tqProvider.updateTaskStatus(
        taskId,
        'in_progress',
        `Processing chunk ${chunkIndex}/${chunks.length}...`
      );

      try {
        const extracted = await this.processChunk(model, chunk, params.sourceFilePath, params.token);
        if (extracted) {
          allDecisions.push(extracted);
        }
      } catch (err) {
        this.outputChannel.appendLine(
          `[Docuvia/TaskRunner] Error processing chunk ${chunkIndex}: ${String(err)}`
        );
        // Continue processing remaining chunks (non-fatal)
      }
    }

    // 2. Write extracted decisions to .docuvia workspace folder
    try {
      await this.writeExtractionResults(params.sourceFilePath, allDecisions);
      this.tqProvider.updateTaskStatus(taskId, 'done', `${allDecisions.length} decision(s) extracted`);
    } catch (err) {
      this.tqProvider.updateTaskStatus(taskId, 'failed', `Write error: ${String(err)}`);
    }
  }

  private async processChunk(
    model: vscode.LanguageModelChat,
    chunk: string,
    sourceFile: string,
    token: vscode.CancellationToken
  ): Promise<string | null> {
    const messages = [
      vscode.LanguageModelChatMessage.User(
        `You are an expert software architect. Analyze the following code chunk from "${path.basename(sourceFile)}" ` +
        `and extract architectural decisions as YAML. Each decision must have: ` +
        `title (string), rationale (string), status ("proposed"|"accepted"|"deprecated"). ` +
        `Output ONLY a YAML list. If there are no architectural decisions in this chunk, output an empty list: []\n\n` +
        `Code:\n\`\`\`\n${chunk}\n\`\`\``
      ),
    ];

    const response = await model.sendRequest(messages, {}, token);
    let result = '';
    for await (const part of response.text) {
      result += part;
    }

    const cleaned = result.replace(/^```ya?ml\n?/i, '').replace(/\n?```$/, '').trim();
    return cleaned === '[]' || cleaned === '' ? null : cleaned;
  }

  private async writeExtractionResults(
    sourceFile: string,
    decisions: string[]
  ): Promise<void> {
    if (decisions.length === 0) return;

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;

    const { v4: uuidv4 } = await import('uuid');
    const date = new Date().toISOString().slice(0, 10);
    const sourceSlug = path.basename(sourceFile, path.extname(sourceFile))
      .toLowerCase().replace(/[^a-z0-9]+/g, '-');

    for (let i = 0; i < decisions.length; i++) {
      const id = uuidv4();
      const slug = `${sourceSlug}-extracted-${i + 1}`;
      const mdContent = [
        '---',
        `id: "${id}"`,
        `l2_module_id: ""`,
        `title: "Extracted from ${path.basename(sourceFile)} (${i + 1})"`,
        `date: "${date}"`,
        `status: "proposed"`,
        '---',
        '',
        `## Extracted Decisions`,
        '',
        '```yaml',
        decisions[i],
        '```',
        '',
        `> _Auto-extracted from \`${sourceFile}\`. Review and edit this file to promote to accepted._`,
      ].join('\n');

      const uri = vscode.Uri.file(
        path.join(workspaceRoot, '.docuvia', 'l3_decisions', `${slug}.md`)
      );
      await vscode.workspace.fs.writeFile(uri, Buffer.from(mdContent, 'utf-8'));
    }
  }

  private chunkContent(content: string): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += CHUNK_SIZE) {
      chunks.push(content.slice(i, i + CHUNK_SIZE));
    }
    return chunks;
  }
}
```

---

### Step 3 — Update `artifacts/vscode-client/src/extension.ts`

Add the following at the top of the `activate` function, after `tqProvider` is created:

```typescript
import { registerChatParticipant } from './ChatParticipant.js';
import { TaskRunner } from './TaskRunner.js';

// Inside activate(), after tqProvider is registered:

// ─── Task Runner ──────────────────────────────────────────────────────────
const taskRunner = new TaskRunner(tqProvider, outputChannel);

// ─── Chat Participant ─────────────────────────────────────────────────────
const chatParticipant = registerChatParticipant(context, store, taskRunner);
context.subscriptions.push(chatParticipant);

// ─── New Commands ─────────────────────────────────────────────────────────

context.subscriptions.push(
  vscode.commands.registerCommand('docuvia.runExtraction', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showWarningMessage('Docuvia: Open a file to extract decisions from.');
      return;
    }
    const filePath = editor.document.uri.fsPath;
    const content = editor.document.getText();
    const tokenSource = new vscode.CancellationTokenSource();
    context.subscriptions.push(tokenSource);
    const taskId = await taskRunner.queueExtraction({
      label: `L3 extract: ${path.basename(filePath)}`,
      content,
      sourceFilePath: filePath,
      token: tokenSource.token,
    });
    void vscode.window.showInformationMessage(
      `Docuvia: Extraction task ${taskId} queued. Check Task Queue panel.`
    );
  })
);

context.subscriptions.push(
  vscode.commands.registerCommand('docuvia.clearCompletedTasks', () => {
    tqProvider.clearCompleted();
  })
);

context.subscriptions.push(
  vscode.commands.registerCommand('docuvia.acceptL1Tags', async (yamlContent: string) => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) return;
    const uri = vscode.Uri.file(path.join(workspaceRoot, '.docuvia', 'l1_tags.yaml'));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(yamlContent, 'utf-8'));
    void vscode.window.showInformationMessage('Docuvia: l1_tags.yaml updated from @docuvia chat.');
  })
);
```

---

### Step 4 — Update `artifacts/vscode-client/package.json`

#### 4.4.1 Add `chatParticipants` contribution point

Add inside `"contributes"`:

```json
"chatParticipants": [
  {
    "id": "docuvia",
    "name": "docuvia",
    "fullName": "Docuvia Knowledge Graph",
    "description": "Explore your project's architecture, query local decisions, and extract L3 knowledge.",
    "isSticky": false,
    "commands": [
      {
        "name": "explore",
        "description": "Detect project type and suggest L1 tags for .docuvia/l1_tags.yaml"
      },
      {
        "name": "query",
        "description": "Search local knowledge graph for matching modules and decisions"
      },
      {
        "name": "extract",
        "description": "Queue L3 decision extraction for the active or specified file"
      },
      {
        "name": "help",
        "description": "Show available commands and usage"
      }
    ]
  }
]
```

#### 4.4.2 Add new command entries to `"commands"` array

```json
{
  "command": "docuvia.runExtraction",
  "title": "Docuvia: Run L3 Extraction on Active File",
  "icon": "$(beaker)"
},
{
  "command": "docuvia.clearCompletedTasks",
  "title": "Docuvia: Clear Completed Tasks",
  "icon": "$(clear-all)"
},
{
  "command": "docuvia.acceptL1Tags",
  "title": "Docuvia: Accept L1 Tags (internal)",
  "enablement": "never"
}
```

#### 4.4.3 Add menu entries for new commands

Under `"view/title"`:

```json
{
  "command": "docuvia.clearCompletedTasks",
  "when": "view == docuvia.taskQueue",
  "group": "navigation"
}
```

Under `"editor/title"` (or `"editor/context"`):

```json
{
  "command": "docuvia.runExtraction",
  "when": "editorIsOpen",
  "group": "docuvia"
}
```

---

## 5. TypeScript Interface Summary

All new interfaces introduced in Phase 3:

```typescript
// --- In ChatParticipant.ts ---

interface L1TemplateTag {
  slug: string;
  name: string;
  description: string;
}

interface L1Template {
  projectType: 'frontend' | 'backend' | 'fullstack' | 'monorepo' | 'library' | 'cli';
  label: string;
  keywords: string[];
  tags: L1TemplateTag[];
}

// --- In TaskRunner.ts ---

interface ExtractionParams {
  label: string;
  content: string;
  sourceFilePath: string;
  token: vscode.CancellationToken;
  type?: TaskType;  // from TaskQueueTreeProvider.ts
}
```

No changes needed to `types.ts`, `KnowledgeStore.ts`, or `TaskQueueTreeProvider.ts` — all required APIs (`addTask`, `updateTaskStatus`, `clearCompleted`) are already present.

---

## 6. Phase 5 Placeholder Stub

In `handleQuery` within `ChatParticipant.ts`, insert this comment block verbatim:

```typescript
// TODO Phase 5 — Central Server Breadth Query
// When `GlobalConfig.server_url` is configured (via ~/.docuvia/config.yaml),
// classify the query intent using the VS Code LM API.
// If intent is "breadth" (cross-project), forward to:
//   POST {server_url}/api/query   { prompt: query, projectId: undefined }
// Display results as a separate "Cross-Project Results" section in the stream.
// Implementation: see docs/vscode-extension-roadmap.md Phase 5.
```

---

## 7. Affected Packages

| Package | Scope of Change |
|---------|----------------|
| `@workspace/vscode-client` | **Primary** — 2 new files, 2 modified files |

No changes to `@workspace/api-server`, `@workspace/db`, `@workspace/api-spec`, or `@workspace/kg-engine`.

---

## 8. Verifiable Success Checklist

- [ ] `pnpm --filter @workspace/vscode-client run typecheck` passes with 0 errors
- [ ] `package.json` `contributes.chatParticipants` is present and well-formed
- [ ] `@docuvia /help` in VS Code Chat returns the command table markdown
- [ ] `@docuvia /explore` in a React workspace returns a YAML block with `ui-components`, `routing`, and `state-management` tags
- [ ] `@docuvia /explore` in an empty workspace (no `README.md`, no `package.json`) asks a clarifying question
- [ ] `@docuvia /query auth` returns matching modules/decisions from a loaded `.docuvia/` snapshot
- [ ] `@docuvia /extract` on an open TypeScript file adds a task to the Task Queue TreeView with status `pending` then transitions to `in_progress`
- [ ] `docuvia.runExtraction` from Command Palette triggers the same flow as `/extract`
- [ ] `docuvia.clearCompletedTasks` removes `done` items from TreeView
- [ ] `docuvia.acceptL1Tags` writes YAML to `.docuvia/l1_tags.yaml` and shows confirmation message
- [ ] Content > 4000 chars is split into multiple chunks; they are processed sequentially
- [ ] No `fetch()`, no `require('openai')`, no `require('axios')` in any Phase 3 file
