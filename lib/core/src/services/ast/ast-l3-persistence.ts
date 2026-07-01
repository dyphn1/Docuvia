import { db } from "@workspace/db";
import { l2NodesTable, l3NodesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { IAstL3Persistence } from "../../interfaces/ast-ingestion.interfaces.js";
import {
  SymbolEvent,
  ContractEvent,
  IngestionResult,
  L3ProcessingResult,
  ContractEndpointsResult,
} from "../../types/ast-ingestion.types.js";
import { chunkArray } from "../../utils/array-utils.js";

const BATCH_INSERT_CHUNK = 500;

export class AstL3PersistenceService implements IAstL3Persistence {
  public async processBatchL3Nodes(
    projectId: number,
    classEvents: SymbolEvent[],
    functionEvents: SymbolEvent[],
    filePathToL2Id: Map<string, number>,
    result: IngestionResult
  ): Promise<L3ProcessingResult> {
    const fqnToL3Id = new Map<string, number>();
    const nameToL3Id = new Map<string, number>();
    const l3IdToL2Id = new Map<number, number>();

    const allSymbolEvents = [...classEvents, ...functionEvents];

    for (const sym of allSymbolEvents) {
      const l2Id = filePathToL2Id.get(sym.filePath);
      if (l2Id) {
        sym.l2NodeId = l2Id;
      }
    }

    const validSymbols = allSymbolEvents.filter((s) => s.l2NodeId > 0);
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
        const inserted = await db
          .insert(l3NodesTable)
          .values(chunk)
          .onConflictDoNothing()
          .returning({
            id: l3NodesTable.id,
            l2NodeId: l3NodesTable.l2NodeId,
            title: l3NodesTable.title,
          });
        l3InsertedIds.push(...inserted);
      }

      result.l3Created = validSymbols.length;
    }

    for (const inserted of l3InsertedIds) {
      nameToL3Id.set(inserted.title, inserted.id);
      l3IdToL2Id.set(inserted.id, inserted.l2NodeId);
    }

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

    for (const sym of validSymbols) {
      fqnToL3Id.set(sym.fqn, 0);
    }
    for (let i = 0; i < validSymbols.length && i < l3InsertedIds.length; i++) {
      fqnToL3Id.set(validSymbols[i].fqn, l3InsertedIds[i]?.id || 0);
    }

    return { fqnToL3Id, nameToL3Id, l3IdToL2Id };
  }

  public async batchInsertL3Nodes(
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

  public async processBatchContractEndpoints(
    projectId: number,
    contractEvents: ContractEvent[],
    filePathToL2Id: Map<string, number>,
    nameToL3Id: Map<string, number>,
    l3IdToL2Id: Map<number, number>,
    result: IngestionResult
  ): Promise<ContractEndpointsResult> {
    const contractEndpointToL3Id = new Map<string, number>();
    const contractPathToL2Id = new Map<string, number>();

    const topLevelContracts = contractEvents.filter((e) => !e.method);
    const endpointEvents = contractEvents.filter((e) => !!e.method);

    for (const tc of topLevelContracts) {
      const l2Id = filePathToL2Id.get(tc.filePath);
      if (l2Id) {
        contractPathToL2Id.set(tc.filePath, l2Id);
      }
    }

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
          const inserted = await db
            .insert(l3NodesTable)
            .values(chunk)
            .onConflictDoNothing()
            .returning({
              id: l3NodesTable.id,
              l2NodeId: l3NodesTable.l2NodeId,
              title: l3NodesTable.title,
            });
          endpointInserted.push(...inserted);
        }

        for (const ins of endpointInserted) {
          nameToL3Id.set(ins.title, ins.id);
          l3IdToL2Id.set(ins.id, ins.l2NodeId);
        }

        result.l3Created += endpointL3Values.length;
        result.contractsCreated = endpointL3Values.length;
      }
    }

    return { contractEndpointToL3Id, contractPathToL2Id };
  }
}
