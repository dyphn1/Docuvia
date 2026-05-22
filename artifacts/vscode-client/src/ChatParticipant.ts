import * as path from 'path';
import * as vscode from 'vscode';
import { CentralServerAuthError, CentralServerClient } from './CentralServerClient.js';
import { KnowledgeStore } from './KnowledgeStore.js';
import { TaskRunner } from './TaskRunner.js';

// ─── L1 Template types ────────────────────────────────────────────────────────

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

// ─── L1 ontology templates ────────────────────────────────────────────────────

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

// ─── Main export ──────────────────────────────────────────────────────────────

export function registerDocuviaChatParticipant(
  context: vscode.ExtensionContext,
  store: KnowledgeStore,
  taskRunner: TaskRunner,
  centralClient: CentralServerClient
): vscode.ChatParticipant {
  const handler: vscode.ChatRequestHandler = async (request, _context, stream, token) => {
    const cmd = request.command;
    if (cmd === 'explore' || (!cmd && request.prompt.toLowerCase().includes('explore'))) {
      return handleExplore(stream, token);
    }
    switch (cmd) {
      case 'query':
        return handleQuery(request, stream, store, centralClient);
      case 'extract':
        return handleExtract(request, stream, token, taskRunner);
      case 'help':
      default:
        return handleHelp(stream);
    }
  };

  const participant = vscode.chat.createChatParticipant('docuvia.assistant', handler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.svg');

  participant.followupProvider = {
    provideFollowups: async (_result, _context, _token) => {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        return [];
      }
      try {
        await vscode.workspace.fs.stat(
          vscode.Uri.file(path.join(workspaceRoot, '.docuvia'))
        );
        return [];
      } catch {
        return [{ prompt: '/explore', label: 'Explore this project and suggest L1 tags' }];
      }
    },
  };

  return participant;
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleExplore(
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  stream.progress('Reading workspace files...');

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    stream.markdown('No workspace folder is open.');
    return;
  }

  // Read README.md (continue if absent)
  let readmeContent = '';
  try {
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.file(path.join(workspaceRoot, 'README.md'))
    );
    readmeContent = Buffer.from(bytes).toString('utf-8');
  } catch {
    // file absent — continue
  }

  // Read package.json (continue if absent)
  let pkgJson: Record<string, unknown> = {};
  try {
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.file(path.join(workspaceRoot, 'package.json'))
    );
    pkgJson = JSON.parse(Buffer.from(bytes).toString('utf-8')) as Record<string, unknown>;
  } catch {
    // file absent — continue
  }

  const detected = detectProjectType(readmeContent, pkgJson);

  if (detected) {
    stream.progress(`Detected project type: ${detected.label}`);
    const refinedYaml = await refineTagsWithLM(detected, readmeContent, token);
    stream.markdown(
      `**Detected:** ${detected.label}\n\nSuggested \`.docuvia/l1_tags.yaml\`:\n\n\`\`\`yaml\n${refinedYaml}\n\`\`\``
    );
    stream.button({
      command: 'docuvia.acceptL1Tags',
      title: 'Accept & Write to .docuvia/l1_tags.yaml',
      arguments: [refinedYaml],
    });
  } else {
    // Interactive fallback — ask one clarifying question
    stream.markdown(
      "I couldn't detect your project type automatically.\n\n" +
        '**What best describes your project?**\n' +
        '- `frontend` — React, Vue, Angular, etc.\n' +
        '- `backend` — Express, Django, Rails, etc.\n' +
        '- `fullstack` — Both frontend and backend\n' +
        '- `monorepo` — Multiple packages in one repo\n' +
        '- `library` — An SDK or npm package\n' +
        '- `cli` — A command-line tool\n\n' +
        'Reply with `/explore <type>` (e.g. `/explore backend`) to get tag suggestions.'
    );
  }
}

async function handleQuery(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  store: KnowledgeStore,
  centralClient: CentralServerClient
): Promise<void> {
  const query = request.prompt.trim().toLowerCase();
  if (!query) {
    stream.markdown(
      'Usage: `/query <search term>` — searches your local `.docuvia` knowledge graph.'
    );
    return;
  }

  // ── Breadth routing ────────────────────────────────────────────────────────
  if (isBreadthQuery(query)) {
    await handleBreadthQuery(query, stream, centralClient);
    return;
  }

  // ── Local depth search ─────────────────────────────────────────────────────
  const snapshot = store.snapshot;
  if (!snapshot) {
    stream.markdown('No `.docuvia/` folder loaded. Run **Docuvia: Init Project** first.');
    return;
  }

  const matchingModules = snapshot.modules.filter(
    (m) =>
      m.name.toLowerCase().includes(query) ||
      m.slug.includes(query) ||
      (m.description ?? '').toLowerCase().includes(query)
  );

  const matchingDecisions = [...snapshot.decisions.values()].filter(
    (d) => d.title.toLowerCase().includes(query) || d.body.toLowerCase().includes(query)
  );

  if (matchingModules.length === 0 && matchingDecisions.length === 0) {
    stream.markdown(`No local results found for **"${query}"**.`);
    return;
  }

  if (matchingModules.length > 0) {
    stream.markdown(
      `### Matching L2 Modules\n` +
        matchingModules
          .map((m) => `- **${m.name}** (\`${m.slug}\`) — ${m.description ?? ''}`)
          .join('\n')
    );
  }

  if (matchingDecisions.length > 0) {
    stream.markdown(
      `### Matching L3 Decisions\n` +
        matchingDecisions
          .slice(0, 5)
          .map((d) => `- **${d.title}** [${d.status}] — \`${d.filePath}\``)
          .join('\n')
    );
  }
}

/** Detect cross-project "breadth" queries that should be routed to the central server. */
function isBreadthQuery(query: string): boolean {
  const breadthPatterns = [
    'other projects',
    'cross-project',
    'how do others',
    'how do other',
  ];
  return query.startsWith('@') || breadthPatterns.some((p) => query.includes(p));
}

async function handleBreadthQuery(
  query: string,
  stream: vscode.ChatResponseStream,
  centralClient: CentralServerClient
): Promise<void> {
  stream.progress('Searching cross-project knowledge...');
  try {
    const results = await centralClient.query(query, 10);
    if (results.length === 0) {
      stream.markdown(
        `No cross-project results found for **"${query}"**.` +
          (centralClient.isServerConfigured()
            ? ''
            : '\n\n_Tip: Configure `server_url` in `~/.docuvia/config.yaml` to enable cross-project search._')
      );
      return;
    }
    stream.markdown(`### Cross-Project Results\n`);
    for (const r of results) {
      const tags = r.l1Tags.length > 0 ? ` · \`${r.l1Tags.join('`, `')}\`` : '';
      stream.markdown(`**${r.title}** — _${r.projectName}_${tags}\n> ${r.snippet}\n`);
    }
  } catch (err) {
    if (err instanceof CentralServerAuthError) {
      void vscode.window.showErrorMessage(
        "Docuvia: Authentication required. Run 'Docuvia: Set Server Token'."
      );
      stream.markdown(
        '_Authentication required. Set your server token via the Command Palette: **Docuvia: Set Server Token**._'
      );
    } else {
      stream.markdown(`_Cross-project search failed: ${String(err)}_`);
    }
  }
}

async function handleExtract(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
  taskRunner: TaskRunner
): Promise<void> {
  const activeEditor = vscode.window.activeTextEditor;
  const filePath = request.prompt.trim() || activeEditor?.document.uri.fsPath;

  if (!filePath) {
    stream.markdown(
      'Usage: `/extract [file-path]` — queue L3 decision extraction for a file. Open a file first or provide a path.'
    );
    return;
  }

  let content = '';
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

// ─── Project type detection ───────────────────────────────────────────────────

function detectProjectType(
  readmeContent: string,
  pkgJson: Record<string, unknown>
): L1Template | null {
  const readmeLower = readmeContent.toLowerCase();

  const allDeps = new Set<string>([
    ...Object.keys((pkgJson['dependencies'] as object) ?? {}),
    ...Object.keys((pkgJson['devDependencies'] as object) ?? {}),
  ]);

  // Monorepo fast path
  const hasWorkspaces =
    !!pkgJson['workspaces'] ||
    readmeLower.includes('monorepo') ||
    readmeLower.includes('pnpm-workspace');

  if (hasWorkspaces) {
    return L1_TEMPLATES.find((t) => t.projectType === 'monorepo') ?? null;
  }

  // Score each template
  const scores = L1_TEMPLATES.map((template) => {
    let score = 0;
    for (const kw of template.keywords) {
      if (readmeLower.includes(kw)) {
        score += 1;
      }
      if (allDeps.has(kw)) {
        score += 2; // dependency match is stronger signal
      }
    }
    return { template, score };
  });

  const best = scores.sort((a, b) => b.score - a.score)[0];
  return best.score >= 2 ? best.template : null;
}

// ─── LM tag refinement ────────────────────────────────────────────────────────

async function refineTagsWithLM(
  template: L1Template,
  readmeContent: string,
  token: vscode.CancellationToken
): Promise<string> {
  const readmeExcerpt = readmeContent.slice(0, 1500);

  const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
  if (models.length === 0) {
    return await buildRawYaml(template);
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
    return yaml.replace(/^```ya?ml\n?/i, '').replace(/\n?```$/, '').trim();
  } catch {
    return await buildRawYaml(template);
  }
}

async function buildRawYaml(template: L1Template): Promise<string> {
  const { v4: uuidv4 } = await import('uuid');
  return template.tags
    .map((tag) =>
      [
        `- id: "${uuidv4()}"`,
        `  slug: "${tag.slug}"`,
        `  name: "${tag.name}"`,
        `  description: "${tag.description}"`,
      ].join('\n')
    )
    .join('\n');
}
