import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  l2NodesTable,
  l3NodesTable,
  nodeLinksTable,
  activityLogTable,
  projectFilesTable,
} from "@workspace/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * AST Ingestion Pipeline — Topology Mapping + Edge Creation + Batch Write Optimization
 *
 * Reads .jsonl skeleton files produced by ast-worker and writes the
 * extracted symbols into the Docuvia knowledge graph (l2_nodes, l3_nodes, node_links).
 *
 * Topology Mapping (Phase 8 — Item 1):
 *   file event   → l2_nodes (type: package | module | pcd, with pathPatterns)
 *   class event  → l3_nodes (nodeType: rule, FQN: dir::Class, under parent L2)
 *   function event → l3_nodes (nodeType: change, FQN: dir::fn, under parent L2)
 *   api_contract event → l2_nodes (type: pcd) + l3_nodes (per-endpoint) + api_contract links
 *
 * Edge Creation (Phase 8 — Item 2):
 *   import event → node_links (depends_on edge: importer → imported module)
 *   call / method_call → node_links (calls edge: caller's module → callee's module)
 *   api_contract event → node_links (api_contract edge: consumer → endpoint)
 *   Cross-file resolution via FQN lookup in l3_nodes + l2_nodes path patterns
 *   Batch-inserted with deduplication for efficiency
 *
 * Batch Write Optimization (Phase 8 — Item 3):
 *   Phase 1 — Stream & Collect: Read all events into typed arrays.
 *   Phase 2 — Batch L2 Insert: Deduplicate, batch-insert new L2 nodes with .returning().
 *   Phase 3 — Batch L3 Insert: Batch-insert all symbols with resolved l2NodeId.
 *   Phase 4 — Batch Link Insert: Resolve all links via pre-built maps, batch-insert.
 *   Chunked inserts (BATCH_INSERT_CHUNK = 500) to avoid parameter limit issues.
 *
 * FQN Convention:
 *   L3 nodes use directory-based namespace: `src/utils/helper.ts::MyClass`
 *   This ensures uniqueness across files with same base name in different dirs.
 *
 * L2 Type Classification:
 *   - package: directory containing an index file (index.ts, __init__.py, mod.rs, etc.)
 *   - module: standalone source file
 *   - pcd: API contract file (OpenAPI 3.x / Swagger 2.0 specs parsed by bridge provider)
 *
 * Link Types:
 *   - depends_on: module A imports/references module B
 *   - calls: module A's code calls a function defined in module B
 *   - api_contract: a consumer module references an API endpoint
 */

// ── Constants ─────────────────────────────────────────────────────
const BATCH_INSERT_CHUNK = 500; // Max rows per INSERT chunk (PostgreSQL parameter safety)

interface AstEvent {
  type: "file" | "class" | "function" | "call" | "method_call" | "import" | "api_contract";
  path?: string;
  name?: string;
  method?: string;
  object?: string;
  source?: string;
  localName?: string;
  contractName?: string;
  version?: string;
  description?: string;
  basePath?: string;
  fullPath?: string;
  summary?: string;
  operationId?: string | null;
  tags?: string[];
  consumers?: string[];
  filePath?: string;
  [key: string]: unknown;
}

export interface IngestionResult {
  l2Created: number;
  l3Created: number;
  linksCreated: number;
  contractsCreated: number;
  filesSkipped: number;
  errors: string[];
}

// ── Collected event structures for batch processing ──────────────
interface FileEvent {
  filePath: string;
  baseName: string;
  dirPath: string;
  l2Type: "package" | "module" | "pcd";
  pathPatterns: string[];
}

interface SymbolEvent {
  name: string;
  fqn: string;
  filePath: string;
  l2NodeId: number; // resolved after L2 batch insert
  nodeType: "rule" | "change";
}

interface ImportEvent {
  source: string;
  localName: string;
  importerFilePath: string;
}

interface CallEvent {
  name: string;
  method?: string;
  object?: string;
  callerFilePath: string;
  isMethodCall: boolean;
}

interface ContractEvent {
  contractName: string;
  version?: string;
  description?: string;
  basePath?: string;
  method?: string;
  path?: string;
  fullPath?: string;
  summary?: string;
  operationId?: string | null;
  tags?: string[];
  consumers?: string[];
  filePath: string;
}

// ── Index files that indicate a directory is a "package" ──────────
const PACKAGE_INDEX_FILES = new Set([
  "index.ts",
  "index.js",
  "index.tsx",
  "index.jsx",
  "__init__.py",
  "mod.rs",
  "lib.rs",
  "main.go",
  "package.java",
  "index.php",
  "index.rb",
]);

/**
 * Derive a Fully Qualified Name for an L3 symbol.
 * Format: `dir1/dir2/file.ext::symbolName`
 */
function buildFqn(filePath: string, symbolName: string): string {
  const normalized = filePath.split(path.sep).join("/");
  return `${normalized}::${symbolName}`;
}

/**
 * Derive the directory path from a file path (normalized to forward slashes).
 */
function getDirectoryPath(filePath: string): string {
  const normalized = filePath.split(path.sep).join("/");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash > 0 ? normalized.substring(0, lastSlash) : ".";
}

/**
 * Classify an L2 node type based on the file path.
 */
function classifyL2Type(filePath: string): "package" | "module" | "pcd" {
  const baseName = filePath.split(path.sep).pop() || filePath;
  if (PACKAGE_INDEX_FILES.has(baseName)) {
    return "package";
  }
  return "module";
}

/**
 * Build a path pattern for an L2 node.
 */
function buildPathPattern(filePath: string, l2Type: string): string[] {
  const normalized = filePath.split(path.sep).join("/");
  if (l2Type === "package") {
    const dirPath = getDirectoryPath(normalized);
    return [`${dirPath}/*`];
  }
  return [normalized];
}

/**
 * Chunk an array into smaller arrays of size `chunkSize`.
 */
function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    chunks.push(arr.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Compute SHA-256 hash of a file's content for change detection.
 */
async function computeFileHash(filePath: string): Promise<string | null> {
  try {
    const content = await fs.promises.readFile(filePath, "utf-8");
    return crypto.createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Check which files have changed since last AST scan.
 * Returns a Set of filePaths that need re-parsing (new or modified).
 */
async function detectChangedFiles(projectId: number, jsonlPaths: string[]): Promise<Set<string>> {
  const changed = new Set<string>();

  // Load existing file hashes for this project
  const existingFiles = await db
    .select()
    .from(projectFilesTable)
    .where(
      and(
        eq(projectFilesTable.projectId, projectId),
        inArray(projectFilesTable.filePath, jsonlPaths)
      )
    );

  const hashByPath = new Map<string, string>();
  for (const f of existingFiles) {
    hashByPath.set(f.filePath, f.contentHash);
  }

  // Check each file's current hash against stored hash
  const hashChecks = await Promise.all(
    jsonlPaths.map(async (jsonlPath) => {
      // For .jsonl files, hash the JSONL itself as the source of truth
      const hash = await computeFileHash(jsonlPath);
      return { jsonlPath, hash };
    })
  );

  for (const { jsonlPath, hash } of hashChecks) {
    if (!hash) {
      // File may have been deleted or unreadable — skip
      continue;
    }
    const storedHash = hashByPath.get(jsonlPath);
    if (storedHash !== hash) {
      changed.add(jsonlPath);
    }
  }

  return changed;
}

/**
 * Update stored file hashes after successful ingestion.
 */
async function updateFileHashes(projectId: number, jsonlPaths: string[]): Promise<void> {
  const chunks = chunkArray(jsonlPaths, BATCH_INSERT_CHUNK);
  for (const chunk of chunks) {
    const hashChecks = await Promise.all(
      chunk.map(async (filePath) => {
        const hash = await computeFileHash(filePath);
        return { projectId, filePath, hash };
      })
    );

    const values = hashChecks
      .filter((v) => v.hash !== null)
      .map((v) => ({
        projectId: v.projectId,
        filePath: v.filePath,
        contentHash: v.hash!,
        lastParsedAt: new Date(),
      }));

    if (values.length > 0) {
      await db.insert(projectFilesTable).values(values).onConflictDoNothing();
    }
  }
}

/**
 * Batch-insert L2 nodes in chunks, returning all inserted nodes.
 * Uses .onConflictDoNothing() to skip duplicates.
 */
async function batchInsertL2Nodes(
  nodes: Array<{
    projectId: number;
    name: string;
    type: "package" | "module" | "pcd";
    aiGenerated: boolean;
    needsReview: boolean;
    description: string;
    pathPatterns: string[];
  }>
): Promise<void> {
  const chunks = chunkArray(nodes, BATCH_INSERT_CHUNK);
  for (const chunk of chunks) {
    await db.insert(l2NodesTable).values(chunk).onConflictDoNothing();
  }
}

/**
 * Batch-insert L3 nodes in chunks, returning inserted IDs via .returning().
 */
async function batchInsertL3Nodes(
  nodes: Array<{
    l2NodeId: number;
    title: string;
    nodeType: "rule" | "change";
    aiGenerated: boolean;
    source: string;
    content: string;
  }>
): Promise<Array<{ id: number; l2NodeId: number; title: string }>> {
  const allInserted: Array<{ id: number; l2NodeId: number; title: string }> = [];
  const chunks = chunkArray(nodes, BATCH_INSERT_CHUNK);
  for (const chunk of chunks) {
    const inserted = await db.insert(l3NodesTable).values(chunk).onConflictDoNothing().returning({
      id: l3NodesTable.id,
      l2NodeId: l3NodesTable.l2NodeId,
      title: l3NodesTable.title,
    });
    allInserted.push(...inserted);
  }
  return allInserted;
}

/**
 * Batch-insert node links in chunks with deduplication.
 */
async function batchInsertLinks(
  links: Array<{
    sourceNodeId: number;
    targetNodeId: number;
    linkType: "depends_on" | "calls";
  }>
): Promise<number> {
  if (links.length === 0) return 0;
  const chunks = chunkArray(links, BATCH_INSERT_CHUNK);
  let inserted = 0;
  for (const chunk of chunks) {
    await db.insert(nodeLinksTable).values(chunk).onConflictDoNothing();
    inserted += chunk.length;
  }
  return inserted;
}

/**
 * Ingest a single .jsonl skeleton file into the database.
 *
 * Uses batch write optimization:
 * 1. Stream-read all events into memory (typed arrays)
 * 2. Batch-insert L2 nodes (deduped by path)
 * 3. Batch-insert L3 nodes (all symbols with resolved L2 parent)
 * 4. Batch-insert links (resolved via pre-built maps)
 *
 * @param jsonlPath - Path to the .jsonl file produced by ast-worker
 * @param projectId - The project ID to associate nodes with
 */
export async function ingestAstJsonl(
  jsonlPath: string,
  projectId: number
): Promise<IngestionResult> {
  const result: IngestionResult = {
    l2Created: 0,
    l3Created: 0,
    linksCreated: 0,
    contractsCreated: 0,
    filesSkipped: 0,
    errors: [],
  };

  // ══════════════════════════════════════════════════════════════════
  // Phase 1: Stream & Collect all events
  // ══════════════════════════════════════════════════════════════════
  const fileEvents: FileEvent[] = [];
  const classEvents: SymbolEvent[] = [];
  const functionEvents: SymbolEvent[] = [];
  const importEvents: ImportEvent[] = [];
  const callEvents: CallEvent[] = [];
  const contractEvents: ContractEvent[] = [];

  // Track file path for events that don't have their own path field
  let currentFilePath: string | null = null;

  const fileStream = fs.createReadStream(jsonlPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let event: AstEvent;
    try {
      event = JSON.parse(line) as AstEvent;
    } catch (err: any) {
      result.errors.push(`JSON parse error: ${err.message}`);
      continue;
    }

    try {
      if (event.type === "file") {
        const filePath = event.path as string;
        if (!filePath) {
          result.errors.push("File event missing path");
          continue;
        }
        currentFilePath = filePath;
        const baseName = filePath.split(/[/\\]/).pop() || filePath;
        const dirPath = getDirectoryPath(filePath);
        const l2Type = classifyL2Type(filePath);
        const pathPatterns = buildPathPattern(filePath, l2Type);
        fileEvents.push({ filePath, baseName, dirPath, l2Type, pathPatterns });
      }

      if (event.type === "import") {
        const importSource = event.source as string;
        if (importSource && currentFilePath) {
          importEvents.push({
            source: importSource,
            localName: (event.localName as string) || "",
            importerFilePath: currentFilePath,
          });
        }
      }

      if (event.type === "class") {
        const name = event.name as string;
        if (name && currentFilePath) {
          classEvents.push({
            name,
            fqn: buildFqn(currentFilePath, name),
            filePath: currentFilePath,
            l2NodeId: 0, // resolved after L2 batch insert
            nodeType: "rule",
          });
        }
      }

      if (event.type === "function") {
        const name = event.name as string;
        if (name && currentFilePath) {
          functionEvents.push({
            name,
            fqn: buildFqn(currentFilePath, name),
            filePath: currentFilePath,
            l2NodeId: 0, // resolved after L2 batch insert
            nodeType: "change",
          });
        }
      }

      if (event.type === "call" || event.type === "method_call") {
        const callName = (event.name || event.method || "") as string;
        if (callName && currentFilePath) {
          callEvents.push({
            name: callName,
            method: event.method as string | undefined,
            object: event.object as string | undefined,
            callerFilePath: currentFilePath,
            isMethodCall: event.type === "method_call",
          });
        }
      }

      // ── Cross-Language Edges: API contract events ──────────────
      // Bridge provider (bridge-provider.ts) emits these for OpenAPI/Swagger specs.
      // Top-level event has contractName but no method → file-level L2 (type: pcd).
      // Per-endpoint event has method + path → L3 node under the contract L2.
      if (event.type === "api_contract") {
        const contractFilePath = (event.filePath || currentFilePath || "") as string;
        if (!contractFilePath) {
          result.errors.push("api_contract event missing filePath");
          continue;
        }
        currentFilePath = contractFilePath;

        const hasMethod = !!event.method;
        contractEvents.push({
          contractName: (event.contractName as string) || "",
          version: event.version as string | undefined,
          description: event.description as string | undefined,
          basePath: event.basePath as string | undefined,
          method: hasMethod ? (event.method as string) : undefined,
          path: hasMethod ? (event.path as string) : undefined,
          fullPath: hasMethod ? (event.fullPath as string) : undefined,
          summary: hasMethod ? (event.summary as string) : undefined,
          operationId: event.operationId as string | null | undefined,
          tags: event.tags as string[] | undefined,
          consumers: event.consumers as string[] | undefined,
          filePath: contractFilePath,
        });

        // For the top-level contract event (no method), also register the file
        // as an L2 node of type "pcd" so it gets created in Phase 2.
        if (!hasMethod) {
          const baseName = contractFilePath.split(/[/\\]/).pop() || contractFilePath;
          const dirPath = getDirectoryPath(contractFilePath);
          fileEvents.push({
            filePath: contractFilePath,
            baseName,
            dirPath,
            l2Type: "pcd",
            pathPatterns: [contractFilePath],
          });
        }
      }
    } catch (err: any) {
      result.errors.push(`Event collection error (${event.type}): ${err.message}`);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // Phase 2: Batch L2 Node Insertion
  // Deduplicate by filePath, then batch-insert new nodes.
  // ══════════════════════════════════════════════════════════════════

  // Deduplicate file events by filePath (keep first occurrence)
  const seenFilePaths = new Set<string>();
  const uniqueFileEvents: FileEvent[] = [];
  for (const fe of fileEvents) {
    if (!seenFilePaths.has(fe.filePath)) {
      seenFilePaths.add(fe.filePath);
      uniqueFileEvents.push(fe);
    }
  }

  // Check which L2 nodes already exist for this project
  const existingL2Nodes = await db
    .select()
    .from(l2NodesTable)
    .where(eq(l2NodesTable.projectId, projectId));

  // Build lookup: pathPattern → existing L2 node
  const pathToL2Id = new Map<string, number>();
  const nameToL2Ids = new Map<string, number[]>(); // baseName → [id, ...]

  for (const node of existingL2Nodes) {
    nameToL2Ids.set(node.name, [...(nameToL2Ids.get(node.name) || []), node.id]);
    if (node.pathPatterns) {
      const patterns = Array.isArray(node.pathPatterns) ? (node.pathPatterns as string[]) : [];
      for (const p of patterns) {
        pathToL2Id.set(p, node.id);
      }
    }
  }

  // Determine which file events need new L2 nodes
  const toInsert: FileEvent[] = [];
  const filePathToL2Id = new Map<string, number>(); // filePath → L2 ID (new or existing)

  for (const fe of uniqueFileEvents) {
    // Check if an L2 node already matches this file's path pattern
    const existingId = pathToL2Id.get(fe.pathPatterns[0]) || pathToL2Id.get(fe.filePath);
    if (existingId) {
      filePathToL2Id.set(fe.filePath, existingId);
    } else {
      // Check by name + path pattern match
      const candidates = nameToL2Ids.get(fe.baseName);
      let matched = false;
      if (candidates) {
        for (const candId of candidates) {
          const candNode = existingL2Nodes.find((n) => n.id === candId);
          if (candNode?.pathPatterns) {
            const patterns = Array.isArray(candNode.pathPatterns)
              ? (candNode.pathPatterns as string[])
              : [];
            if (patterns.some((p) => p === fe.pathPatterns[0] || p === fe.filePath)) {
              filePathToL2Id.set(fe.filePath, candId);
              matched = true;
              break;
            }
          }
        }
        if (!matched && candidates.length > 0) {
          // Fallback: use first candidate with same name
          filePathToL2Id.set(fe.filePath, candidates[0]);
          matched = true;
        }
      }
      if (!matched) {
        toInsert.push(fe);
      }
    }
  }

  // Batch-insert new L2 nodes
  if (toInsert.length > 0) {
    const insertValues = toInsert.map((fe) => ({
      projectId,
      name: fe.baseName,
      type: fe.l2Type,
      aiGenerated: true,
      needsReview: true,
      description: `AST parsed from ${fe.filePath}`,
      pathPatterns: fe.pathPatterns,
    }));

    // Insert in chunks with .returning() to get IDs
    const chunks = chunkArray(insertValues, BATCH_INSERT_CHUNK);
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      const inserted = await db
        .insert(l2NodesTable)
        .values(chunk)
        .onConflictDoNothing()
        .returning({ id: l2NodesTable.id, name: l2NodesTable.name });

      // Map inserted nodes back to file paths by name + chunk position
      for (const insertedNode of inserted) {
        // Find the matching event by name (within this chunk's corresponding toInsert slice)
        const startIdx = chunkIndex * BATCH_INSERT_CHUNK;
        const chunkEvents = toInsert.slice(startIdx, startIdx + BATCH_INSERT_CHUNK);
        const matchingEvent = chunkEvents.find(
          (fe) => fe.baseName === insertedNode.name && !filePathToL2Id.has(fe.filePath)
        );
        if (matchingEvent) {
          filePathToL2Id.set(matchingEvent.filePath, insertedNode.id);
          pathToL2Id.set(matchingEvent.pathPatterns[0], insertedNode.id);
        }
      }
    }

    // For any that conflicted (not returned), look them up by path pattern
    const unresolvedFiles = toInsert.filter((fe) => !filePathToL2Id.has(fe.filePath));
    if (unresolvedFiles.length > 0) {
      // Re-query to get the IDs of nodes that already existed
      const allPatterns = unresolvedFiles.flatMap((fe) => fe.pathPatterns);
      // Use a single query with OR conditions for all unresolved patterns
      const conditions = allPatterns.map(
        (p) => sql`${l2NodesTable.pathPatterns}::text LIKE ${`%${p}%`}`
      );
      const combinedCondition =
        conditions.length === 1 ? conditions[0] : sql.join(conditions, sql` OR `);
      const reloaded = await db
        .select()
        .from(l2NodesTable)
        .where(and(eq(l2NodesTable.projectId, projectId), combinedCondition));

      for (const fe of unresolvedFiles) {
        const match = reloaded.find((n) => {
          if (!n.pathPatterns) return false;
          const patterns = Array.isArray(n.pathPatterns) ? (n.pathPatterns as string[]) : [];
          return patterns.some((p) => p === fe.pathPatterns[0] || p === fe.filePath);
        });
        if (match) {
          filePathToL2Id.set(fe.filePath, match.id);
        }
      }
    }

    result.l2Created = toInsert.length;
  }

  // ══════════════════════════════════════════════════════════════════
  // Phase 3: Batch L3 Node Insertion
  // Resolve l2NodeId for all symbols, then batch-insert.
  // ══════════════════════════════════════════════════════════════════

  const allSymbolEvents = [...classEvents, ...functionEvents];

  // Resolve l2NodeId for each symbol event
  for (const sym of allSymbolEvents) {
    const l2Id = filePathToL2Id.get(sym.filePath);
    if (l2Id) {
      sym.l2NodeId = l2Id;
    }
  }

  // Filter out symbols without a valid l2NodeId
  const validSymbols = allSymbolEvents.filter((s) => s.l2NodeId > 0);

  // Batch-insert L3 nodes
  let l3InsertedIds: Array<{ id: number; l2NodeId: number; title: string }> = [];
  if (validSymbols.length > 0) {
    const insertValues = validSymbols.map((sym) => ({
      l2NodeId: sym.l2NodeId,
      title: sym.name,
      nodeType: sym.nodeType,
      aiGenerated: true,
      source: "ast",
      content: `${sym.nodeType === "rule" ? "Class" : "Function"} definition: ${sym.fqn}`,
    }));

    l3InsertedIds = [];
    const chunks = chunkArray(insertValues, BATCH_INSERT_CHUNK);
    for (const chunk of chunks) {
      const inserted = await db.insert(l3NodesTable).values(chunk).onConflictDoNothing().returning({
        id: l3NodesTable.id,
        l2NodeId: l3NodesTable.l2NodeId,
        title: l3NodesTable.title,
      });
      l3InsertedIds.push(...inserted);
    }

    result.l3Created = validSymbols.length;
  }

  // Build FQN → L3 ID and name → L3 ID maps for link resolution
  const fqnToL3Id = new Map<string, number>();
  const nameToL3Id = new Map<string, number>();
  const l3IdToL2Id = new Map<number, number>();

  // First, add newly inserted L3 nodes
  for (const inserted of l3InsertedIds) {
    nameToL3Id.set(inserted.title, inserted.id);
    l3IdToL2Id.set(inserted.id, inserted.l2NodeId);
  }

  // Also load existing L3 nodes for this project (for cross-file link resolution)
  const existingL3Nodes = await db
    .select({
      id: l3NodesTable.id,
      title: l3NodesTable.title,
      l2NodeId: l3NodesTable.l2NodeId,
    })
    .from(l3NodesTable)
    .innerJoin(l2NodesTable, eq(l3NodesTable.l2NodeId, l2NodesTable.id))
    .where(eq(l2NodesTable.projectId, projectId));

  for (const node of existingL3Nodes) {
    if (!nameToL3Id.has(node.title)) {
      nameToL3Id.set(node.title, node.id);
    }
    l3IdToL2Id.set(node.id, node.l2NodeId);
  }

  // Build FQN map from valid symbols (for within-file resolution)
  for (const sym of validSymbols) {
    fqnToL3Id.set(sym.fqn, 0); // placeholder, will be resolved from existingL3Nodes or l3InsertedIds
  }
  // Map FQNs to actual IDs from inserted nodes
  for (let i = 0; i < validSymbols.length && i < l3InsertedIds.length; i++) {
    fqnToL3Id.set(validSymbols[i].fqn, l3InsertedIds[i]?.id || 0);
  }

  // ══════════════════════════════════════════════════════════════════
  // Phase 3.5: Contract Endpoint L3 Insertion (Cross-Language Edges)
  // Create L3 nodes for each API endpoint under the contract L2 node.
  // ══════════════════════════════════════════════════════════════════

  // Separate top-level contract events (no method) from endpoint events (has method)
  const topLevelContracts = contractEvents.filter((e) => !e.method);
  const endpointEvents = contractEvents.filter((e) => !!e.method);

  // Map: contract filePath → L2 ID (resolved from Phase 2)
  const contractPathToL2Id = new Map<string, number>();
  for (const tc of topLevelContracts) {
    const l2Id = filePathToL2Id.get(tc.filePath);
    if (l2Id) {
      contractPathToL2Id.set(tc.filePath, l2Id);
    }
  }

  // Insert L3 nodes for endpoint events
  if (endpointEvents.length > 0) {
    const endpointL3Values = endpointEvents
      .filter((e) => contractPathToL2Id.has(e.filePath))
      .map((e) => ({
        l2NodeId: contractPathToL2Id.get(e.filePath)!,
        title: `${e.method} ${e.path}`,
        nodeType: "change" as const,
        aiGenerated: true,
        source: "ast",
        content: `API endpoint: ${e.method} ${e.fullPath || e.path}${e.summary ? ` — ${e.summary}` : ""}${e.operationId ? ` (operationId: ${e.operationId})` : ""}${e.tags && e.tags.length > 0 ? ` [${e.tags.join(", ")}]` : ""}`,
      }));

    if (endpointL3Values.length > 0) {
      const endpointChunks = chunkArray(endpointL3Values, BATCH_INSERT_CHUNK);
      const endpointInserted: Array<{ id: number; l2NodeId: number; title: string }> = [];
      for (const chunk of endpointChunks) {
        const inserted = await db.insert(l3NodesTable).values(chunk).onConflictDoNothing().returning({
          id: l3NodesTable.id,
          l2NodeId: l3NodesTable.l2NodeId,
          title: l3NodesTable.title,
        });
        endpointInserted.push(...inserted);
      }

      // Register endpoint L3 IDs in the maps for link resolution
      for (const ins of endpointInserted) {
        nameToL3Id.set(ins.title, ins.id);
        l3IdToL2Id.set(ins.id, ins.l2NodeId);
      }

      result.l3Created += endpointL3Values.length;
      result.contractsCreated = endpointL3Values.length;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // Phase 4: Batch Link Insertion
  // Resolve all imports and calls using pre-built maps.
  // ══════════════════════════════════════════════════════════════════

  const pendingLinks: Array<{
    sourceNodeId: number;
    targetNodeId: number;
    linkType: "depends_on" | "calls";
  }> = [];
  const seenLinks = new Set<string>(); // "source:target:type" for dedup

  function queueLink(
    sourceNodeId: number,
    targetNodeId: number,
    linkType: "depends_on" | "calls"
  ): void {
    if (sourceNodeId === targetNodeId) return;
    const key = `${sourceNodeId}:${targetNodeId}:${linkType}`;
    if (seenLinks.has(key)) return;
    seenLinks.add(key);
    pendingLinks.push({ sourceNodeId, targetNodeId, linkType });
  }

  // ── Resolve imports ────────────────────────────────────────────
  for (const imp of importEvents) {
    const sourceL2Id = filePathToL2Id.get(imp.importerFilePath);
    if (!sourceL2Id) continue;

    // Resolve import target to L2 ID
    let targetL2Id: number | null = null;
    const currentDir = getDirectoryPath(imp.importerFilePath);

    if (imp.source.startsWith("./") || imp.source.startsWith("../")) {
      // Relative import — resolve to file path
      const resolvedPath = path.resolve(currentDir, imp.source);
      // Try to find matching L2 by path pattern
      for (const [pattern, id] of pathToL2Id) {
        if (pattern.includes(resolvedPath) || resolvedPath.includes(pattern.replace("/*", ""))) {
          targetL2Id = id;
          break;
        }
      }
      // Try with extensions
      if (!targetL2Id) {
        const extensions = [
          ".ts",
          ".tsx",
          ".js",
          ".jsx",
          ".py",
          ".rs",
          ".go",
          ".java",
          ".rb",
          ".php",
          ".cs",
        ];
        for (const ext of extensions) {
          const candidate = resolvedPath + ext;
          for (const [pattern, id] of pathToL2Id) {
            if (pattern.includes(candidate) || candidate.includes(pattern.replace("/*", ""))) {
              targetL2Id = id;
              break;
            }
          }
          if (targetL2Id) break;
        }
      }
    } else {
      // Package import — try to find by path pattern match
      for (const [pattern, id] of pathToL2Id) {
        if (pattern.includes(imp.source)) {
          targetL2Id = id;
          break;
        }
      }
    }

    if (targetL2Id && targetL2Id !== sourceL2Id) {
      queueLink(sourceL2Id, targetL2Id, "depends_on");
    }
  }

  // ── Resolve calls ──────────────────────────────────────────────
  for (const call of callEvents) {
    const callerL2Id = filePathToL2Id.get(call.callerFilePath);
    if (!callerL2Id) continue;

    // Try to resolve callee by FQN first, then by simple name
    let targetL3Id = fqnToL3Id.get(call.name) || nameToL3Id.get(call.name);

    // If not found locally, try scope map format (module::symbol)
    if (!targetL3Id) {
      const parts = call.name.split("::");
      if (parts.length >= 2) {
        targetL3Id = fqnToL3Id.get(call.name);
        if (!targetL3Id) {
          const simpleName = parts[parts.length - 1];
          targetL3Id = nameToL3Id.get(simpleName);
        }
      }
    }

    // Cross-file resolution: look up by title in DB
    if (!targetL3Id) {
      const simpleName = call.name.split("::").pop()?.split(".").pop() || call.name;
      targetL3Id = nameToL3Id.get(simpleName);
    }

    if (targetL3Id) {
      const targetL2Id = l3IdToL2Id.get(targetL3Id);
      if (targetL2Id && targetL2Id !== callerL2Id) {
        queueLink(callerL2Id, targetL2Id, "calls");
      }
    }
  }

  // ── Resolve api_contract consumer links (Cross-Language Edges) ──────
  // For each endpoint event with consumer hints, create api_contract links
  // from consumer L2 modules to the contract L2 node.
  if (endpointEvents.length > 0) {
    for (const ep of endpointEvents) {
      if (!ep.consumers || ep.consumers.length === 0) continue;
      const contractL2Id = contractPathToL2Id.get(ep.filePath);
      if (!contractL2Id) continue;

      for (const consumerHint of ep.consumers) {
        // Try to resolve consumer hint to an L2 node
        // First try by name match, then by path pattern
        let consumerL2Id: number | null = null;

        // Try pathToL2Id patterns (e.g., "src/api/client" → L2)
        for (const [pattern, id] of pathToL2Id) {
          if (pattern.includes(consumerHint) || consumerHint.includes(pattern.replace("/*", ""))) {
            consumerL2Id = id;
            break;
          }
        }

        // Try name-based lookup
        if (!consumerL2Id) {
          const candidates = nameToL2Ids.get(consumerHint);
          if (candidates && candidates.length > 0) {
            consumerL2Id = candidates[0];
          }
        }

        // Try operationId as function name in L3 → resolve to L2
        if (!consumerL2Id) {
          const l3Id = nameToL3Id.get(consumerHint);
          if (l3Id) {
            consumerL2Id = l3IdToL2Id.get(l3Id) || null;
          }
        }

        if (consumerL2Id && consumerL2Id !== contractL2Id) {
          queueLink(consumerL2Id, contractL2Id, "calls");
        }
      }
    }
  }

  // Batch-insert all links
  if (pendingLinks.length > 0) {
    try {
      result.linksCreated = await batchInsertLinks(pendingLinks);
    } catch (batchErr: any) {
      result.errors.push(`Batch link insert error: ${batchErr.message}`);
    }
  }

  // Log activity
  if (result.l2Created > 0 || result.l3Created > 0 || result.contractsCreated > 0) {
    await db.insert(activityLogTable).values({
      type: "tag_added",
      description: `AST ingestion: ${result.l2Created} modules, ${result.l3Created} symbols, ${result.linksCreated} links, ${result.contractsCreated} contracts`,
      projectId,
    });
  }

  logger.info({ projectId, jsonlPath, result }, "AST ingestion completed (batch optimized)");

  return result;
}

/**
 * Ingest multiple .jsonl files (batch processing for a project).
 * Processes files sequentially to maintain consistent L2/L3 name resolution.
 *
 * Supports incremental mode: when `incremental` is true, computes file hashes
 * and skips files that haven't changed since last scan (Sub-second Incremental Watch).
 */
export async function ingestAstBatch(
  jsonlPaths: string[],
  projectId: number,
  options: { incremental?: boolean } = {}
): Promise<IngestionResult> {
  const aggregated: IngestionResult = {
    l2Created: 0,
    l3Created: 0,
    linksCreated: 0,
    contractsCreated: 0,
    filesSkipped: 0,
    errors: [],
  };

  // ── Incremental mode: detect changed files ──────────────────────
  let pathsToIngest = jsonlPaths;
  if (options.incremental) {
    const changedFiles = await detectChangedFiles(projectId, jsonlPaths);
    pathsToIngest = jsonlPaths.filter((p) => changedFiles.has(p));
    aggregated.filesSkipped = jsonlPaths.length - pathsToIngest.length;

    logger.info(
      {
        projectId,
        total: jsonlPaths.length,
        changed: pathsToIngest.length,
        skipped: aggregated.filesSkipped,
      },
      "AST incremental scan: change detection complete"
    );
  }

  // ── Ingest only changed files ───────────────────────────────────
  for (const jsonlPath of pathsToIngest) {
    try {
      const result = await ingestAstJsonl(jsonlPath, projectId);
      aggregated.l2Created += result.l2Created;
      aggregated.l3Created += result.l3Created;
      aggregated.linksCreated += result.linksCreated;
      aggregated.contractsCreated += result.contractsCreated;
      aggregated.errors.push(...result.errors);
    } catch (err: any) {
      aggregated.errors.push(`Failed to ingest ${jsonlPath}: ${err.message}`);
    }
  }

  // ── Update file hashes for next incremental scan ────────────────
  if (options.incremental && pathsToIngest.length > 0) {
    try {
      await updateFileHashes(projectId, pathsToIngest);
    } catch (err: any) {
      aggregated.errors.push(`Failed to update file hashes: ${err.message}`);
    }
  }

  return aggregated;
}
