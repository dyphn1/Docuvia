import type { IGraphStore } from "./graph-store.interfaces.js";
import type { ParsedAstFileResult } from "./ast.interfaces.js";

/**
 * Turns parsed AST results into knowledge-graph nodes/edges — Docuvia's core semantic-graph
 * construction logic (Domain Core), built entirely on `IGraphStore`'s repo interfaces.
 */
export interface IGraphPersister {
  persist(input: {
    store: IGraphStore;
    workspaceRoot: string;
    projectId: number;
    parsedResults: ParsedAstFileResult[];
    tags: string[];
  }): Promise<{ updatedCount: number }>;
}
