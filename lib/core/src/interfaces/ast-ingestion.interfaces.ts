export type FileIngestRequest = { filePath: string; oldPath?: string };
import {
  IngestionResult,
  ProcessedEvents,
  FileEvent,
  SymbolEvent,
  ImportEvent,
  CallEvent,
  ContractEvent,
  L2ProcessingResult,
  L3ProcessingResult,
  ContractEndpointsResult,
} from "../types/ast-ingestion.types.js";

export interface IAstEventStreamer {
  streamAndCollectEvents(jsonlPath: string, result: IngestionResult): Promise<ProcessedEvents>;
}

export interface IAstChangeDetector {
  detectChangedFiles(projectId: number, requests: FileIngestRequest[]): Promise<Set<string>>;
  updateFileHashes(projectId: number, jsonlPaths: string[]): Promise<void>;
  computeFileHash(filePath: string): Promise<string | null>;
}

export interface IAstL2Persistence {
  processBatchL2Nodes(
    projectId: number,
    fileEvents: FileEvent[],
    result: IngestionResult
  ): Promise<L2ProcessingResult>;
  batchInsertL2Nodes(
    nodes: Array<{
      projectId: number;
      name: string;
      type: "package" | "module" | "pcd";
      aiGenerated: boolean;
      needsReview: boolean;
      description: string;
      pathPatterns: string[];
    }>
  ): Promise<void>;
}

export interface IAstL3Persistence {
  processBatchL3Nodes(
    projectId: number,
    classEvents: SymbolEvent[],
    functionEvents: SymbolEvent[],
    filePathToL2Id: Map<string, number>,
    result: IngestionResult
  ): Promise<L3ProcessingResult>;
  batchInsertL3Nodes(
    nodes: Array<{
      l2NodeId: number;
      title: string;
      nodeType: "rule" | "change";
      aiGenerated: boolean;
      source: string;
      content: string;
    }>
  ): Promise<Array<{ id: number; l2NodeId: number; title: string }>>;
  processBatchContractEndpoints(
    projectId: number,
    contractEvents: ContractEvent[],
    filePathToL2Id: Map<string, number>,
    nameToL3Id: Map<string, number>,
    l3IdToL2Id: Map<number, number>,
    result: IngestionResult
  ): Promise<ContractEndpointsResult>;
}

export interface IAstEdgePersistence {
  processBatchLinks(
    projectId: number,
    importEvents: ImportEvent[],
    callEvents: CallEvent[],
    contractEvents: ContractEvent[],
    filePathToL2Id: Map<string, number>,
    pathToL2Id: Map<string, number>,
    fqnToL3Id: Map<string, number>,
    contractEndpointToL3Id: Map<string, number>,
    nameToL3Id: Map<string, number>,
    l3IdToL2Id: Map<number, number>,
    contractPathToL2Id: Map<string, number>,
    result: IngestionResult
  ): Promise<void>;
  batchInsertLinks(
    links: Array<{
      sourceNodeId: number;
      targetNodeId: number;
      linkType: "depends_on" | "calls";
    }>
  ): Promise<number>;
}
